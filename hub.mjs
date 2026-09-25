import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStorage, one, all, run, transaction } from './storage.mjs';
import { random, hash, encodePassword, checkPassword, cookies, sessionUser, connectorDevice, setCookie, sameOrigin } from './security.mjs';
import { departments, event, createTask, claim, sweep, finishJob, report } from './workflow.mjs';
import { configureChatwork, chatworkStatus, sendPendingHuman, pollChatwork } from './chatwork.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const db=openStorage(root);
const port=Number(process.env.REI_PORT||4178);
const host=process.env.REI_HOST||'127.0.0.1';
if(host!=='127.0.0.1'&&host!=='::1'&&process.env.REI_ALLOW_INSECURE_LAN!=='1') throw new Error('外部待受には暗号化したトンネルを使用してください。直接LANに公開する場合はREI_ALLOW_INSECURE_LAN=1が必要です');
const uid=()=>crypto.randomUUID();
const isSecure=req=>req.socket.encrypted||req.headers['x-forwarded-proto']==='https';
const send=(res,code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
const error=(res,code,message)=>send(res,code,{error:message});
const text=(value,max=8000)=>{const result=String(value??'').trim();if(!result||result.length>max)throw Object.assign(new Error(`1〜${max}文字で入力してください`),{status:400});return result;};
async function body(req) {let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>200000)throw Object.assign(new Error('送信内容が長すぎます'),{status:413});}try{return JSON.parse(raw||'{}');}catch{throw Object.assign(new Error('JSONが正しくありません'),{status:400});}}
function taskJson(t) {return {id:t.id,parentId:t.parent_id,kind:t.kind,text:t.text,department:t.department,status:t.status,assignedDeviceId:t.device_id,result:t.result,error:t.error,createdAt:new Date(t.created_at).toISOString(),startedAt:t.started_at?new Date(t.started_at).toISOString():null,finishedAt:t.finished_at?new Date(t.finished_at).toISOString():null};}
function createSetupToken() {
  if(one(db,'SELECT id FROM users LIMIT 1')) return;
  const raw=random();
  run(db,"DELETE FROM invites WHERE role='owner'");
  run(db,'INSERT INTO invites(hash,role,expires_at) VALUES(?,?,?)',hash(raw),'owner',Date.now()+7*86400000);
  console.log(`REIの初期登録: http://${host}:${port}/?setup=${raw}`);
}
createSetupToken();
async function api(req,res,route) {
  if(!['GET','POST'].includes(req.method))return error(res,405,'許可されていない操作です');
  if(req.method==='POST'&&!sameOrigin(req))return error(res,403,'送信元が一致しません');
  if(route==='setup/status'&&req.method==='GET')return send(res,200,{needsSetup:!one(db,'SELECT id FROM users LIMIT 1')});
  if(route==='setup/complete'&&req.method==='POST') {
    const data=await body(req),invite=one(db,'SELECT * FROM invites WHERE hash=? AND used=0 AND expires_at>?',hash(String(data.token||'')),Date.now());
    if(!invite)return error(res,403,'登録リンクが無効か期限切れです');
    const username=text(data.username,80),password=String(data.password||'');
    if(password.length<14||password.length>200)return error(res,400,'パスワードは14文字以上にしてください');
    if(invite.role==='owner'&&one(db,"SELECT id FROM users WHERE role='owner'"))return error(res,409,'所有者は登録済みです');
    const encoded=await encodePassword(password);
    transaction(db,()=>{run(db,'INSERT INTO users(id,username,salt,digest,role) VALUES(?,?,?,?,?)',uid(),username,encoded.salt,encoded.digest,invite.role);run(db,'UPDATE invites SET used=1 WHERE hash=?',invite.hash);});
    return send(res,201,{ok:true});
  }
  if(route==='auth/login'&&req.method==='POST') {
    const data=await body(req),user=one(db,'SELECT * FROM users WHERE username=? AND disabled=0',String(data.username||''));
    if(!user)return error(res,401,'ユーザー名かパスワードが違います');
    if(user.locked_until>Date.now())return error(res,429,'しばらく待ってから再試行してください');
    if(!await checkPassword(String(data.password||''),user.salt,user.digest)) {const failures=user.failures+1;run(db,'UPDATE users SET failures=?,locked_until=? WHERE id=?',failures,failures>=5?Date.now()+900000:0,user.id);return error(res,401,'ユーザー名かパスワードが違います');}
    run(db,'UPDATE users SET failures=0,locked_until=0 WHERE id=?',user.id);
    const raw=random();run(db,'INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)',hash(raw),user.id,Date.now()+7*86400000);
    setCookie(res,raw,604800,isSecure(req));
    return send(res,200,{user:{id:user.id,username:user.username,role:user.role}});
  }
  if(route==='auth/logout'&&req.method==='POST') {const raw=cookies(req).rei_session;if(raw)run(db,'DELETE FROM sessions WHERE hash=?',hash(raw));setCookie(res,'',0,isSecure(req));return send(res,200,{ok:true});}

  if(route.startsWith('connector/')) {
    const device=connectorDevice(db,req);if(!device)return error(res,401,'端末認証に失敗しました');
    if(route==='connector/heartbeat'&&req.method==='POST') {const data=await body(req);run(db,'UPDATE devices SET last_seen=?,capabilities=? WHERE id=?',Date.now(),JSON.stringify(Array.isArray(data.capabilities)?data.capabilities:[]),device.id);return send(res,200,{ok:true,deviceId:device.id});}
    if(route==='connector/claim'&&req.method==='POST') {sweep(db);const job=claim(db,device);const devices=all(db,'SELECT id,label,capabilities FROM devices WHERE revoked=0').map(d=>({...d,capabilities:JSON.parse(d.capabilities)}));return send(res,200,{job,devices});}
    if(route==='connector/renew'&&req.method==='POST') {const data=await body(req);const changed=run(db,"UPDATE tasks SET lease_until=? WHERE id=? AND lease_id=? AND device_id=? AND status='running'",Date.now()+240000,String(data.taskId||''),String(data.leaseId||''),device.id);return send(res,200,{ok:changed.changes===1});}
    if(route==='connector/result'&&req.method==='POST') {const data=await body(req);const result=finishJob(db,device,data);if(result.ok)void sendPendingHuman(db,root).catch(e=>console.error('Chatwork:',e.message));return send(res,200,result);}
    return error(res,404,'端末APIが見つかりません');
  }

  const user=sessionUser(db,req);if(!user)return error(res,401,'ログインしてください');
  if(route==='auth/me'&&req.method==='GET')return send(res,200,{user});
  if(route==='bootstrap'&&req.method==='GET') {
    sweep(db);
    const devices=all(db,'SELECT id,label,planner,capabilities,last_seen FROM devices WHERE revoked=0 ORDER BY rowid');
    const workers=devices.map(d=>({id:d.id,name:d.label,kind:'AI',machine:d.label,connected:Date.now()-d.last_seen<30000,planner:!!d.planner}));
    const tasks=all(db,"SELECT * FROM tasks WHERE kind='root' ORDER BY created_at DESC LIMIT 100").map(taskJson);
    return send(res,200,{user,departments,workers,tasks,gateway:{reachable:workers.some(w=>w.connected),version:'REI HUB',agent:'rei'}});
  }
  if(route==='report/today'&&req.method==='GET') {const data=report(db);data.gateway={reachable:!!one(db,'SELECT id FROM devices WHERE revoked=0 AND last_seen>? LIMIT 1',Date.now()-30000)};return send(res,200,data);}
  if(route==='command'&&req.method==='POST') {
    if(user.role==='viewer')return error(res,403,'指示する権限がありません');
    const data=await body(req),message=text(data.text),department=departments.some(d=>d.id===data.department)?data.department:'operations';
    if(/今日.{0,12}(稼働|活動).{0,8}報告/.test(message)) {const data=report(db);data.gateway={reachable:!!one(db,'SELECT id FROM devices WHERE revoked=0 AND last_seen>? LIMIT 1',Date.now()-30000)};return send(res,200,{kind:'report',report:data});}
    const task=createTask(db,message,department,user.id,user.role==='requester');
    return send(res,201,{kind:'task',task:taskJson(task)});
  }
  if(route==='tasks/approve'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'承認する権限がありません');const data=await body(req),task=one(db,"SELECT * FROM tasks WHERE id=? AND kind='root' AND status='approval_pending'",String(data.taskId||''));if(!task)return error(res,404,'承認待ちの仕事が見つかりません');transaction(db,()=>{run(db,"UPDATE tasks SET status='planning' WHERE id=?",task.id);run(db,"UPDATE tasks SET status='ready' WHERE parent_id=? AND kind='plan' AND status='blocked'",task.id);event(db,task.id,user.username,'approved','実行を承認');});return send(res,200,{ok:true});}
  if(route==='tasks/reject'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'却下する権限がありません');const data=await body(req),task=one(db,"SELECT * FROM tasks WHERE id=? AND kind='root' AND status='approval_pending'",String(data.taskId||''));if(!task)return error(res,404,'承認待ちの仕事が見つかりません');transaction(db,()=>{run(db,"UPDATE tasks SET status='cancelled',finished_at=? WHERE id=?",Date.now(),task.id);run(db,"UPDATE tasks SET status='cancelled',finished_at=? WHERE parent_id=? AND kind='plan'",Date.now(),task.id);event(db,task.id,user.username,'rejected','実行を却下');});return send(res,200,{ok:true});}
  if(route==='tasks'&&req.method==='GET') {const tasks=all(db,'SELECT * FROM tasks ORDER BY created_at DESC LIMIT 300').map(taskJson);return send(res,200,{tasks});}
  if(route==='devices'&&req.method==='GET') {const devices=all(db,'SELECT id,label,planner,capabilities,last_seen,revoked FROM devices WHERE revoked=0 ORDER BY rowid').map(d=>({...d,capabilities:JSON.parse(d.capabilities),online:Date.now()-d.last_seen<30000}));return send(res,200,{devices});}
  if(route==='devices/enroll'&&req.method==='POST') {
    if(!['owner','admin'].includes(user.role))return error(res,403,'端末を登録する権限がありません');
    const data=await body(req),label=text(data.label,80),raw=random(),id=uid(),planner=!!data.isPlanner||!one(db,'SELECT id FROM devices WHERE planner=1 AND revoked=0');
    run(db,'INSERT INTO devices(id,label,token_hash,planner) VALUES(?,?,?,?)',id,label,hash(raw),planner?1:0);event(db,null,user.username,'device_enrolled',label);
    return send(res,201,{device:{id,label,isPlanner:planner},token:raw});
  }
  if(route==='devices/revoke'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'端末を解除する権限がありません');const data=await body(req),device=one(db,'SELECT * FROM devices WHERE id=? AND revoked=0',String(data.deviceId||''));if(!device)return error(res,404,'端末が見つかりません');run(db,'UPDATE devices SET revoked=1 WHERE id=?',device.id);event(db,null,user.username,'device_revoked',device.label);return send(res,200,{ok:true});}
  if(route==='users/invite'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'招待する権限がありません');const data=await body(req),role=String(data.role||'requester');if(!['admin','requester','viewer'].includes(role)||(role==='admin'&&user.role!=='owner'))return error(res,400,'役割が無効です');const raw=random();run(db,'INSERT INTO invites(hash,role,expires_at) VALUES(?,?,?)',hash(raw),role,Date.now()+7*86400000);return send(res,201,{token:raw,role});}
  if(route==='chatwork/status'&&req.method==='GET')return send(res,200,chatworkStatus(db));
  if(route==='chatwork/configure'&&req.method==='POST') {if(user.role!=='owner')return error(res,403,'所有者だけが設定できます');const data=await body(req),roomId=text(data.roomId,30),chatToken=text(data.token,300);if(!/^\d+$/.test(roomId))return error(res,400,'ルームIDは数字です');const check=await fetch(`https://api.chatwork.com/v2/rooms/${roomId}`,{headers:{'x-chatworktoken':chatToken},signal:AbortSignal.timeout(15000)});if(!check.ok)return error(res,400,`Chatworkへの接続を確認できません（HTTP ${check.status}）`);return send(res,200,configureChatwork(db,root,roomId,chatToken));}
  if(route==='chatwork/poll'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'権限がありません');return send(res,200,await pollChatwork(db,root));}
  return error(res,404,'APIが見つかりません');
}
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css'};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(url.pathname==='/api')return await api(req,res,url.searchParams.get('route')||'');
    const file=files[url.pathname];if(!file||req.method!=='GET')return error(res,404,'見つかりません');
    const bytes=readFileSync(path.join(root,'public',file));
    res.writeHead(200,{'content-type':`${mime[path.extname(file)]}; charset=utf-8`,'x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(bytes);
  } catch(e) {console.error('REI:',e.message);return error(res,e.status||500,e.status?e.message:'処理に失敗しました');}
});
server.listen(port,host,()=>console.log(`REI Hub: http://${host}:${port}`));
setInterval(()=>{try{sweep(db);void sendPendingHuman(db,root).catch(e=>console.error('REI Chatwork送信:',e.message));void pollChatwork(db,root).catch(e=>console.error('REI Chatwork取得:',e.message));}catch(e){console.error('REI background:',e.message);}},30000).unref();
