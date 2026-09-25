import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStorage, one, all, run, transaction } from './storage.mjs';
import { random, hash, encodePassword, checkPassword, cookies, sessionUser, connectorDevice, setCookie, sameOrigin } from './security.mjs';
import { departments, event, createTask, cancellable, cancelTask, retryPlan, claim, sweep, finishJob, finishRoot, report } from './workflow.mjs';
import { configureChatwork, chatworkStatus, sendPendingHuman, pollChatwork } from './chatwork.mjs';
import { MCP_PRESETS } from './public/mcp-presets.js';
import { createBackup } from './backup.mjs';
import { networkStatus, enableServe } from './network.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const db=openStorage(root);
const port=Number(process.env.REI_PORT||4178);
const host=process.env.REI_HOST||'127.0.0.1';
if(host!=='127.0.0.1'&&host!=='::1'&&process.env.REI_ALLOW_INSECURE_LAN!=='1') throw new Error('外部待受には暗号化したトンネルを使用してください。直接LANに公開する場合はREI_ALLOW_INSECURE_LAN=1が必要です');
const uid=()=>crypto.randomUUID();
let backupInProgress=false;
function localConnectorStatus() {
  const config=process.env.REI_CONNECTOR_CONFIG||path.join(process.env.REI_DATA_DIR||path.join(root,'data'),'connector.json');
  if(!existsSync(config))return {status:'not_configured'};
  try {
    const saved=JSON.parse(readFileSync(config,'utf8'));
    if(typeof saved.token!=='string'||!saved.token)return {status:'needs_attention'};
    const device=one(db,'SELECT id,revoked,last_seen FROM devices WHERE token_hash=?',hash(saved.token));
    if(!device||device.revoked)return {status:'needs_attention'};
    return {status:'registered',deviceId:device.id,online:Date.now()-device.last_seen<30000};
  } catch {return {status:'needs_attention'};}
}
const isSecure=req=>req.socket.encrypted||req.headers['x-forwarded-proto']==='https';
const send=(res,code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
const error=(res,code,message)=>send(res,code,{error:message});
const text=(value,max=8000)=>{const result=String(value??'').trim();if(!result||result.length>max)throw Object.assign(new Error(`1〜${max}文字で入力してください`),{status:400});return result;};
async function body(req) {let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>200000)throw Object.assign(new Error('送信内容が長すぎます'),{status:413});}try{return JSON.parse(raw||'{}');}catch{throw Object.assign(new Error('JSONが正しくありません'),{status:400});}}
function taskJson(t,brief=false) {return {id:t.id,parentId:t.parent_id,kind:t.kind,text:t.text,department:t.department,projectId:t.project_id||null,status:t.status,assignedDeviceId:t.device_id,result:brief?t.result.slice(0,500):t.result,error:brief?t.error.slice(0,500):t.error,createdAt:new Date(t.created_at).toISOString(),startedAt:t.started_at?new Date(t.started_at).toISOString():null,finishedAt:t.finished_at?new Date(t.finished_at).toISOString():null};}
function projectJson(p) {return {id:p.id,name:p.name,objective:p.objective,status:p.status,createdAt:new Date(p.created_at).toISOString(),updatedAt:new Date(p.updated_at).toISOString(),total:p.total||0,completed:p.completed||0,attention:p.attention||0};}
function projects() {return all(db,"SELECT p.*,COUNT(t.id) AS total,COALESCE(SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END),0) AS completed,COALESCE(SUM(CASE WHEN t.status IN ('failed','needs_review') THEN 1 ELSE 0 END),0) AS attention FROM projects p LEFT JOIN tasks t ON t.project_id=p.id AND t.kind='root' GROUP BY p.id ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,p.updated_at DESC").map(projectJson);}
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
  if(route==='connector/pair'&&req.method==='POST') {
    const data=await body(req),code=String(data.code||'').trim();
    if(!/^[A-Za-z0-9_-]{16}$/.test(code))return error(res,403,'接続コードが無効です');
    const raw=random(),id=uid(),now=Date.now();
    const paired=transaction(db,()=>{
      const pairing=one(db,'SELECT * FROM pairings WHERE hash=? AND used=0 AND expires_at>?',hash(code),now);
      if(!pairing)return null;
      run(db,'UPDATE pairings SET used=1 WHERE hash=?',pairing.hash);
      const planner=!one(db,'SELECT id FROM devices WHERE planner=1 AND revoked=0');
      run(db,'INSERT INTO devices(id,label,token_hash,planner) VALUES(?,?,?,?)',id,pairing.label,hash(raw),planner?1:0);
      return {id,label:pairing.label};
    });
    if(!paired)return error(res,403,'接続コードが無効か期限切れです');
    event(db,null,paired.label,'device_paired','端末を接続');
    return send(res,201,{device:paired,token:raw});
  }

  if(route.startsWith('connector/')) {
    const device=connectorDevice(db,req);if(!device)return error(res,401,'端末認証に失敗しました');
    if(route==='connector/heartbeat'&&req.method==='POST') {const data=await body(req),now=Date.now(),agentName=typeof data.agentName==='string'&&data.agentName.trim()?data.agentName.slice(0,80):null,pendingResults=Number.isSafeInteger(data.pendingResults)&&data.pendingResults>=0&&data.pendingResults<=10000?data.pendingResults:null;run(db,'UPDATE devices SET last_seen=?,capabilities=?,agent_name=COALESCE(?,agent_name),pending_results=COALESCE(?,pending_results) WHERE id=?',now,JSON.stringify(Array.isArray(data.capabilities)?data.capabilities:[]),agentName,pendingResults,device.id);if(Array.isArray(data.mcpStatuses))for(const item of data.mcpStatuses.slice(0,100)){if(typeof item?.name!=='string'||!['configured','auth_required','error'].includes(item.status))continue;if(!one(db,'SELECT name FROM mcp_integrations WHERE name=? AND device_id=?',item.name,device.id))continue;run(db,'INSERT INTO device_mcp_status(device_id,name,status,updated_at) VALUES(?,?,?,?) ON CONFLICT(device_id,name) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at',device.id,item.name,item.status,now);}const integrations=all(db,'SELECT name,label,url,auth FROM mcp_integrations WHERE device_id=? ORDER BY name',device.id);const checks=all(db,'SELECT c.name,c.request_id FROM mcp_checks c JOIN mcp_integrations m ON m.name=c.name WHERE m.device_id=? AND c.checked_at<c.requested_at ORDER BY c.requested_at LIMIT 1',device.id);return send(res,200,{ok:true,deviceId:device.id,integrations,checks});}
    if(route==='connector/mcp-check-result'&&req.method==='POST') {const data=await body(req),name=String(data.name||''),requestId=String(data.requestId||''),status=String(data.status||''),toolCount=Number(data.toolCount||0),detail=String(data.error||'').slice(0,400);if(!['success','error','auth_required'].includes(status)||!Number.isSafeInteger(toolCount)||toolCount<0||toolCount>10000)return error(res,400,'MCP検査結果が正しくありません');const check=one(db,'SELECT c.name FROM mcp_checks c JOIN mcp_integrations m ON m.name=c.name WHERE c.name=? AND c.request_id=? AND m.device_id=? AND c.checked_at<c.requested_at',name,requestId,device.id);if(!check)return error(res,409,'MCP検査依頼が無効か処理済みです');run(db,'UPDATE mcp_checks SET checked_at=?,status=?,tool_count=?,error=? WHERE name=? AND request_id=?',Date.now(),status,toolCount,detail,name,requestId);return send(res,200,{ok:true});}
    if(route==='connector/claim'&&req.method==='POST') {sweep(db);const job=claim(db,device);if(job?.project_id)job.project=one(db,'SELECT name,objective FROM projects WHERE id=?',job.project_id)||null;const devices=all(db,'SELECT id,label,agent_name,capabilities,last_seen FROM devices WHERE revoked=0').map(d=>({id:d.id,label:d.label,agentName:d.agent_name,capabilities:JSON.parse(d.capabilities),online:Date.now()-d.last_seen<30000}));return send(res,200,{job,devices});}
    if(route==='connector/renew'&&req.method==='POST') {const data=await body(req);const changed=run(db,"UPDATE tasks SET lease_until=? WHERE id=? AND lease_id=? AND device_id=? AND status='running'",Date.now()+240000,String(data.taskId||''),String(data.leaseId||''),device.id);return send(res,200,{ok:changed.changes===1});}
    if(route==='connector/result'&&req.method==='POST') {const data=await body(req);const result=finishJob(db,device,data);if(result.ok)void sendPendingHuman(db,root).catch(e=>console.error('Chatwork:',e.message));return send(res,200,result);}
    return error(res,404,'端末APIが見つかりません');
  }

  const user=sessionUser(db,req);if(!user)return error(res,401,'ログインしてください');
  if(route==='auth/me'&&req.method==='GET')return send(res,200,{user});
  if(route==='auth/password'&&req.method==='POST') {const data=await body(req),record=one(db,'SELECT * FROM users WHERE id=?',user.id),next=String(data.newPassword||'');if(!await checkPassword(String(data.currentPassword||''),record.salt,record.digest))return error(res,403,'現在のパスワードが違います');if(next.length<14||next.length>200)return error(res,400,'新しいパスワードは14文字以上にしてください');const encoded=await encodePassword(next);run(db,'UPDATE users SET salt=?,digest=? WHERE id=?',encoded.salt,encoded.digest,user.id);run(db,'DELETE FROM sessions WHERE user_id=? AND hash<>?',user.id,hash(cookies(req).rei_session));event(db,null,user.username,'password_changed','パスワードを変更');return send(res,200,{ok:true});}
  if(route==='backup/create'&&req.method==='POST') {if(user.role!=='owner')return error(res,403,'所有者だけがバックアップを作成できます');if(backupInProgress)return error(res,409,'バックアップを作成中です');backupInProgress=true;try{const folder=await createBackup();event(db,null,user.username,'backup_created',path.basename(folder));return send(res,201,{folder});}finally{backupInProgress=false;}}
  if(route==='network/status'&&req.method==='GET') {if(!['owner','admin'].includes(user.role))return error(res,403,'端末の接続を確認する権限がありません');return send(res,200,networkStatus());}
  if(route==='network/serve'&&req.method==='POST') {if(user.role!=='owner')return error(res,403,'所有者だけが接続を有効にできます');return send(res,200,enableServe());}
  if(route==='bootstrap'&&req.method==='GET') {
    sweep(db);
    const devices=all(db,'SELECT id,label,planner,capabilities,last_seen,agent_name,pending_results FROM devices WHERE revoked=0 ORDER BY rowid');
    const workers=devices.map(d=>({id:d.id,name:d.label,kind:'AI',machine:d.label,agentName:d.agent_name,pendingResults:d.pending_results,capabilities:JSON.parse(d.capabilities),connected:Date.now()-d.last_seen<30000,planner:!!d.planner}));
    const recent=all(db,"SELECT * FROM tasks WHERE kind='root' ORDER BY created_at DESC,id DESC LIMIT 101");
    const tasks=recent.slice(0,100).map(task=>taskJson(task,true));
    const humanPending=all(db,"SELECT DISTINCT parent_id FROM tasks WHERE kind='human' AND status IN ('waiting_human','waiting_reply','sending') AND parent_id IS NOT NULL ORDER BY created_at DESC LIMIT 100").map(item=>item.parent_id);
    return send(res,200,{user,departments,workers,tasks,hasOlderTasks:recent.length>100,projects:projects(),humanPending,gateway:{reachable:workers.some(w=>w.connected),version:'REI HUB',agent:'rei'}});
  }
  if(route==='report/today'&&req.method==='GET') {const data=report(db);data.gateway={reachable:!!one(db,'SELECT id FROM devices WHERE revoked=0 AND last_seen>? LIMIT 1',Date.now()-30000)};return send(res,200,data);}
  if(route==='command'&&req.method==='POST') {
    if(user.role==='viewer')return error(res,403,'指示する権限がありません');
    const data=await body(req),message=text(data.text),department=departments.some(d=>d.id===data.department)?data.department:'operations',projectId=data.projectId?String(data.projectId):null;
    if(projectId&&!one(db,"SELECT id FROM projects WHERE id=? AND status='active'",projectId))return error(res,400,'稼働中のプロジェクトを選んでください');
    if(/今日.{0,12}(稼働|活動).{0,8}報告/.test(message)) {const data=report(db);data.gateway={reachable:!!one(db,'SELECT id FROM devices WHERE revoked=0 AND last_seen>? LIMIT 1',Date.now()-30000)};return send(res,200,{kind:'report',report:data});}
    const task=createTask(db,message,department,user.id,user.role==='requester',projectId);
    return send(res,201,{kind:'task',task:taskJson(task)});
  }
  if(route==='projects/create'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'プロジェクトを作成する権限がありません');const data=await body(req),name=text(data.name,80),objective=text(data.objective,2000),id=uid(),now=Date.now();run(db,'INSERT INTO projects(id,name,objective,created_at,updated_at) VALUES(?,?,?,?,?)',id,name,objective,now,now);event(db,null,user.username,'project_created',name);return send(res,201,{project:projectJson(one(db,'SELECT * FROM projects WHERE id=?',id))});}
  if(route==='projects/status'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'プロジェクトを変更する権限がありません');const data=await body(req),status=String(data.status||''),id=String(data.projectId||'');if(!['active','paused','completed'].includes(status))return error(res,400,'状態が正しくありません');const project=one(db,'SELECT * FROM projects WHERE id=?',id);if(!project)return error(res,404,'プロジェクトが見つかりません');run(db,'UPDATE projects SET status=?,updated_at=? WHERE id=?',status,Date.now(),id);event(db,null,user.username,'project_status',`${project.name}: ${status}`);return send(res,200,{project:projectJson(one(db,'SELECT * FROM projects WHERE id=?',id))});}
  if(route==='tasks/approve'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'承認する権限がありません');const data=await body(req),task=one(db,"SELECT * FROM tasks WHERE id=? AND kind='root' AND status='approval_pending'",String(data.taskId||''));if(!task)return error(res,404,'承認待ちの仕事が見つかりません');transaction(db,()=>{run(db,"UPDATE tasks SET status='planning' WHERE id=?",task.id);run(db,"UPDATE tasks SET status='ready' WHERE parent_id=? AND kind='plan' AND status='blocked'",task.id);event(db,task.id,user.username,'approved','実行を承認');});return send(res,200,{ok:true});}
  if(route==='tasks/reject'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'却下する権限がありません');const data=await body(req),task=one(db,"SELECT * FROM tasks WHERE id=? AND kind='root' AND status='approval_pending'",String(data.taskId||''));if(!task)return error(res,404,'承認待ちの仕事が見つかりません');transaction(db,()=>{run(db,"UPDATE tasks SET status='cancelled',finished_at=? WHERE id=?",Date.now(),task.id);run(db,"UPDATE tasks SET status='cancelled',finished_at=? WHERE parent_id=? AND kind='plan'",Date.now(),task.id);event(db,task.id,user.username,'rejected','実行を却下');});return send(res,200,{ok:true});}
  if(route.startsWith('tasks/detail/')&&req.method==='GET') {const id=route.slice('tasks/detail/'.length);if(!/^[a-f0-9-]{36}$/.test(id))return error(res,400,'仕事IDが正しくありません');const root=one(db,"SELECT * FROM tasks WHERE id=? AND kind='root'",id);if(!root)return error(res,404,'仕事が見つかりません');const children=all(db,'SELECT * FROM tasks WHERE parent_id=? ORDER BY created_at,id',id);const events=all(db,'SELECT actor,type,detail,created_at,task_id FROM events WHERE task_id=? OR task_id IN (SELECT id FROM tasks WHERE parent_id=?) ORDER BY created_at,id LIMIT 300',id,id).map(item=>({actor:item.actor,type:item.type,detail:item.detail,taskId:item.task_id,createdAt:new Date(item.created_at).toISOString()}));const canCancel=(['owner','admin'].includes(user.role)||root.created_by===user.id)&&cancellable(db,root);const canRetryPlan=['owner','admin'].includes(user.role)&&root.status==='needs_review'&&children.length===1&&children[0].kind==='plan'&&['failed','needs_review'].includes(children[0].status);return send(res,200,{task:taskJson(root),children:children.map(task=>taskJson(task)),events,canCancel,canRetryPlan});}
  if(route==='tasks/cancel'&&req.method==='POST') {const data=await body(req),root=one(db,"SELECT * FROM tasks WHERE id=? AND kind='root'",String(data.taskId||''));if(!root)return error(res,404,'仕事が見つかりません');if(!['owner','admin'].includes(user.role)&&root.created_by!==user.id)return error(res,403,'中止する権限がありません');if(!cancelTask(db,root,user.username))return error(res,409,'すでに実行中か、中止できない状態です');return send(res,200,{ok:true});}
  if(route==='tasks/retry-plan'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'計画を再実行する権限がありません');const data=await body(req);if(!retryPlan(db,String(data.taskId||''),user.username))return error(res,409,'再実行できる計画が見つかりません');return send(res,200,{ok:true});}
  if(route==='tasks/reassign'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'担当PCを変更する権限がありません');const data=await body(req),id=String(data.taskId||''),deviceId=String(data.deviceId||'');const device=one(db,"SELECT id,label FROM devices WHERE id=? AND revoked=0 AND last_seen>?",deviceId,Date.now()-30000);if(!device)return error(res,400,'接続中のPCを選んでください');const accepted=transaction(db,()=>{const task=one(db,"SELECT id,device_id FROM tasks WHERE id=? AND kind='execute' AND status='ready'",id);if(!task||task.device_id===device.id)return false;run(db,'UPDATE tasks SET device_id=? WHERE id=?',device.id,id);event(db,id,user.username,'reassigned',`担当PCを${device.label}に変更`);return true;});if(!accepted)return error(res,409,'未着手の別PC向け工程が見つかりません');return send(res,200,{ok:true});}
  if(route==='human/respond'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'人の回答を記録する権限がありません');const data=await body(req),id=String(data.taskId||''),answer=text(data.answer,8000);const accepted=transaction(db,()=>{const task=one(db,"SELECT * FROM tasks WHERE id=? AND kind='human' AND status IN ('waiting_human','waiting_reply')",id);if(!task)return false;run(db,"UPDATE tasks SET status='completed',result=?,finished_at=? WHERE id=?",answer,Date.now(),id);event(db,id,user.username,'human_reply','画面から回答を記録');finishRoot(db,task.parent_id);return true;});if(!accepted)return error(res,409,'回答待ちの仕事が見つかりません');return send(res,200,{ok:true});}
  if(route==='tasks/reconcile'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'結果を確認する権限がありません');const data=await body(req),id=String(data.taskId||''),resolution=String(data.resolution||''),note=text(data.note,8000);if(!['completed','failed'].includes(resolution))return error(res,400,'確認結果が正しくありません');const accepted=transaction(db,()=>{const task=one(db,"SELECT * FROM tasks WHERE id=? AND kind IN ('execute','human') AND status='needs_review'",id);if(!task)return false;run(db,'UPDATE tasks SET status=?,result=?,error=?,finished_at=?,lease_id=NULL,lease_until=0 WHERE id=?',resolution,resolution==='completed'?note:'',resolution==='failed'?note:'',Date.now(),id);event(db,id,user.username,'reconciled',`${resolution}: ${note.slice(0,300)}`);finishRoot(db,task.parent_id);return true;});if(!accepted)return error(res,409,'確認待ちの工程が見つかりません');return send(res,200,{ok:true});}
  if(route==='tasks/history'&&req.method==='POST') {const data=await body(req),before=Number(data.beforeTime),id=String(data.beforeId||'');if(!Number.isSafeInteger(before)||before<=0||!/^[a-f0-9-]{36}$/.test(id))return error(res,400,'履歴の位置が正しくありません');const rows=all(db,"SELECT * FROM tasks WHERE kind='root' AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 101",before,before,id);return send(res,200,{tasks:rows.slice(0,100).map(task=>taskJson(task,true)),hasMore:rows.length>100});}
  if(route==='tasks'&&req.method==='GET') {const tasks=all(db,'SELECT * FROM tasks ORDER BY created_at DESC LIMIT 300').map(task=>taskJson(task,true));return send(res,200,{tasks});}
  if(route==='devices'&&req.method==='GET') {const devices=all(db,'SELECT id,label,planner,capabilities,last_seen,revoked,agent_name,pending_results FROM devices WHERE revoked=0 ORDER BY rowid').map(d=>({...d,capabilities:JSON.parse(d.capabilities),online:Date.now()-d.last_seen<30000}));return send(res,200,{devices,localConnector:localConnectorStatus()});}
  if(route==='mcp/list'&&req.method==='GET') {const integrations=all(db,'SELECT m.name,m.label,m.url,m.auth,m.device_id,d.label AS device_label,s.status,s.updated_at,c.requested_at AS check_requested_at,c.checked_at,c.status AS check_status,c.tool_count,c.error AS check_error FROM mcp_integrations m JOIN devices d ON d.id=m.device_id LEFT JOIN device_mcp_status s ON s.name=m.name AND s.device_id=m.device_id LEFT JOIN mcp_checks c ON c.name=m.name ORDER BY m.created_at DESC');return send(res,200,{integrations});}
  if(route==='mcp/check'&&req.method==='POST') {if(user.role!=='owner')return error(res,403,'所有者だけが接続を確認できます');const data=await body(req),name=String(data.name||'');const integration=one(db,'SELECT m.name FROM mcp_integrations m JOIN devices d ON d.id=m.device_id WHERE m.name=? AND d.revoked=0',name);if(!integration)return error(res,404,'連携が見つかりません');const requestId=uid(),requestedAt=Date.now();run(db,"INSERT INTO mcp_checks(name,request_id,requested_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET request_id=excluded.request_id,requested_at=excluded.requested_at,checked_at=0,status='queued',tool_count=0,error=''",name,requestId,requestedAt);return send(res,202,{ok:true});}
  if(route==='mcp/add-batch'&&req.method==='POST') {
    if(user.role!=='owner')return error(res,403,'所有者だけが連携を設定できます');
    const data=await body(req),deviceId=String(data.deviceId||''),ids=data.ids;
    if(!Array.isArray(ids)||ids.length<1||ids.length>100||new Set(ids).size!==ids.length)return error(res,400,'連携先を1〜100件選んでください');
    const presets=ids.map(id=>MCP_PRESETS.find(preset=>preset.id===id&&preset.url));
    if(presets.some(preset=>!preset))return error(res,400,'選択された連携先が見つかりません');
    const device=one(db,'SELECT id FROM devices WHERE id=? AND revoked=0',deviceId);
    if(!device)return error(res,400,'接続先のPCが見つかりません');
    const existing=all(db,'SELECT name,url FROM mcp_integrations WHERE device_id=?',deviceId);
    if(existing.length+presets.filter(preset=>!existing.some(item=>item.url===preset.url)).length>100)return error(res,400,'1台のPCに登録できるMCPは100件までです');
    const added=transaction(db,()=>presets.map(preset=>{
      const duplicate=one(db,'SELECT name FROM mcp_integrations WHERE device_id=? AND url=?',deviceId,preset.url);
      if(duplicate)return {id:preset.id,name:duplicate.name,added:false};
      const name=`rei_${crypto.randomBytes(6).toString('hex')}`;
      run(db,'INSERT INTO mcp_integrations(name,label,url,auth,device_id,created_at) VALUES(?,?,?,?,?,?)',name,preset.label,preset.url,preset.auth,deviceId,Date.now());
      event(db,null,user.username,'mcp_added',`${preset.label} / ${deviceId}`);
      return {id:preset.id,name,added:true};
    }));
    return send(res,201,{integrations:added});
  }
  if(route==='mcp/add'&&req.method==='POST') {
    if(user.role!=='owner')return error(res,403,'所有者だけが連携を設定できます');
    const data=await body(req),label=text(data.label,80),deviceId=String(data.deviceId||''),auth=String(data.auth||'oauth');
    if(!['oauth','none'].includes(auth))return error(res,400,'認証方式が正しくありません');
    const device=one(db,'SELECT id FROM devices WHERE id=? AND revoked=0',deviceId);if(!device)return error(res,400,'接続先のPCが見つかりません');
    let url;try{url=new URL(String(data.url||''));}catch{return error(res,400,'MCPのURLが正しくありません');}
    if(url.protocol!=='https:'||url.username||url.password||url.hash||url.href.length>1000)return error(res,400,'認証情報を含まないHTTPSのMCP URLを入力してください');
    if(one(db,'SELECT name FROM mcp_integrations WHERE device_id=? AND url=?',device.id,url.toString()))return error(res,409,'このPCには同じMCP URLが登録済みです');
    if(one(db,'SELECT COUNT(*) AS count FROM mcp_integrations WHERE device_id=?',device.id).count>=100)return error(res,400,'1台のPCに登録できるMCPは100件までです');
    const name=`rei_${crypto.randomBytes(6).toString('hex')}`;
    run(db,'INSERT INTO mcp_integrations(name,label,url,auth,device_id,created_at) VALUES(?,?,?,?,?,?)',name,label,url.toString(),auth,device.id,Date.now());
    event(db,null,user.username,'mcp_added',`${label} / ${device.id}`);
    return send(res,201,{name,label});
  }
  if(route==='mcp/remove'&&req.method==='POST') {if(user.role!=='owner')return error(res,403,'所有者だけが連携を解除できます');const data=await body(req),name=String(data.name||'');if(!one(db,'SELECT name FROM mcp_integrations WHERE name=?',name))return error(res,404,'連携が見つかりません');transaction(db,()=>{run(db,'DELETE FROM device_mcp_status WHERE name=?',name);run(db,'DELETE FROM mcp_integrations WHERE name=?',name);});event(db,null,user.username,'mcp_removed',name);return send(res,200,{ok:true});}
  if(route==='devices/pairing'&&req.method==='POST') {
    if(!['owner','admin'].includes(user.role))return error(res,403,'端末を登録する権限がありません');
    const data=await body(req),label=text(data.label,80),code=crypto.randomBytes(12).toString('base64url');
    run(db,'DELETE FROM pairings WHERE expires_at<? OR used=1',Date.now());
    run(db,'INSERT INTO pairings(hash,label,expires_at) VALUES(?,?,?)',hash(code),label,Date.now()+600000);
    return send(res,201,{label,code,expiresInSeconds:600});
  }
  if(route==='devices/enroll'&&req.method==='POST') {
    if(!['owner','admin'].includes(user.role))return error(res,403,'端末を登録する権限がありません');
    const data=await body(req),label=text(data.label,80),raw=random(),id=uid(),planner=!!data.isPlanner||!one(db,'SELECT id FROM devices WHERE planner=1 AND revoked=0');
    run(db,'INSERT INTO devices(id,label,token_hash,planner) VALUES(?,?,?,?)',id,label,hash(raw),planner?1:0);event(db,null,user.username,'device_enrolled',label);
    return send(res,201,{device:{id,label,isPlanner:planner},token:raw});
  }
  if(route==='devices/revoke'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'端末を解除する権限がありません');const data=await body(req),device=one(db,'SELECT * FROM devices WHERE id=? AND revoked=0',String(data.deviceId||''));if(!device)return error(res,404,'端末が見つかりません');transaction(db,()=>{run(db,'UPDATE devices SET revoked=1 WHERE id=?',device.id);const active=all(db,"SELECT id FROM tasks WHERE device_id=? AND status='running'",device.id);for(const task of active){run(db,'UPDATE tasks SET lease_until=? WHERE id=?',Date.now()-1,task.id);event(db,task.id,user.username,'device_revoked','担当PCを解除したため結果を確認');}event(db,null,user.username,'device_revoked',device.label);});sweep(db);return send(res,200,{ok:true});}
  if(route==='users/invite'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'招待する権限がありません');const data=await body(req),role=String(data.role||'requester');if(!['admin','requester','viewer'].includes(role)||(role==='admin'&&user.role!=='owner'))return error(res,400,'役割が無効です');const raw=random();run(db,'INSERT INTO invites(hash,role,expires_at) VALUES(?,?,?)',hash(raw),role,Date.now()+7*86400000);return send(res,201,{token:raw,role});}
  if(route==='users/list'&&req.method==='GET') {if(!['owner','admin'].includes(user.role))return error(res,403,'利用者を見る権限がありません');return send(res,200,{users:all(db,"SELECT id,username,role,disabled FROM users ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END,username")});}
  if(route==='users/role'&&req.method==='POST') {if(user.role!=='owner')return error(res,403,'所有者だけが権限を変更できます');const data=await body(req),id=String(data.userId||''),role=String(data.role||'');if(!['admin','requester','viewer'].includes(role))return error(res,400,'役割が正しくありません');const target=one(db,'SELECT id,username,role FROM users WHERE id=?',id);if(!target||target.role==='owner')return error(res,404,'変更できる利用者が見つかりません');run(db,'UPDATE users SET role=? WHERE id=?',role,id);event(db,null,user.username,'user_role',`${target.username}: ${role}`);return send(res,200,{ok:true});}
  if(route==='users/disable'&&req.method==='POST') {if(user.role!=='owner')return error(res,403,'所有者だけが利用者を停止できます');const data=await body(req),id=String(data.userId||''),disabled=data.disabled===true;const target=one(db,'SELECT id,username,role FROM users WHERE id=?',id);if(!target||target.role==='owner'||target.id===user.id)return error(res,404,'変更できる利用者が見つかりません');transaction(db,()=>{run(db,'UPDATE users SET disabled=? WHERE id=?',disabled?1:0,id);if(disabled)run(db,'DELETE FROM sessions WHERE user_id=?',id);event(db,null,user.username,disabled?'user_disabled':'user_enabled',target.username);});return send(res,200,{ok:true});}
  if(route==='chatwork/status'&&req.method==='GET')return send(res,200,chatworkStatus(db));
  if(route==='chatwork/configure'&&req.method==='POST') {if(user.role!=='owner')return error(res,403,'所有者だけが設定できます');const data=await body(req),roomId=text(data.roomId,30),chatToken=text(data.token,300);if(!/^\d+$/.test(roomId))return error(res,400,'ルームIDは数字です');const headers={'x-chatworktoken':chatToken},check=await fetch(`https://api.chatwork.com/v2/rooms/${roomId}`,{headers,signal:AbortSignal.timeout(15000)});if(!check.ok)return error(res,400,`Chatworkへの接続を確認できません（HTTP ${check.status}）`);const me=await fetch('https://api.chatwork.com/v2/me',{headers,signal:AbortSignal.timeout(15000)});if(!me.ok)return error(res,400,`Chatworkのアカウントを確認できません（HTTP ${me.status}）`);const accountId=String((await me.json()).account_id||'');if(!/^\d+$/.test(accountId))return error(res,400,'ChatworkのアカウントIDを確認できません');return send(res,200,configureChatwork(db,root,roomId,chatToken,accountId));}
  if(route==='chatwork/poll'&&req.method==='POST') {if(!['owner','admin'].includes(user.role))return error(res,403,'権限がありません');return send(res,200,await pollChatwork(db,root));}
  return error(res,404,'APIが見つかりません');
}
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/mcp-presets.js':'mcp-presets.js','/style.css':'style.css'};
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
