import crypto from 'node:crypto';
import { one, all, run, transaction } from './storage.mjs';

const id=()=>crypto.randomUUID();
const now=()=>Date.now();
export const departments=[
  {id:'operations',name:'経営・運営',detail:'会社全体の状況と優先順位'},
  {id:'research',name:'調査・企画',detail:'情報収集、分析、提案'},
  {id:'production',name:'制作・開発',detail:'成果物の作成と検証'},
  {id:'sales',name:'営業・顧客',detail:'顧客との接点と提案'},
  {id:'support',name:'サポート',detail:'問い合わせと対応履歴'},
  {id:'people',name:'人との連携',detail:'Chatworkでの依頼と返答'}
];
export function event(db,taskId,actor,type,detail='') {run(db,'INSERT INTO events(id,task_id,actor,type,detail,created_at) VALUES(?,?,?,?,?,?)',id(),taskId,actor,type,detail,now());}
export function createTask(db,text,department,userId,requiresApproval=false,projectId=null) {
  return transaction(db,()=>{
    const root=id(),plan=id(),time=now();
    run(db,'INSERT INTO tasks(id,kind,text,department,status,created_by,created_at,project_id) VALUES(?,?,?,?,?,?,?,?)',root,'root',text,department,requiresApproval?'approval_pending':'planning',userId,time,projectId);
    run(db,'INSERT INTO tasks(id,parent_id,kind,text,department,status,created_by,created_at,project_id) VALUES(?,?,?,?,?,?,?,?,?)',plan,root,'plan',text,department,requiresApproval?'blocked':'ready',userId,time,projectId);
    event(db,root,'user','created',text.slice(0,200));
    return one(db,'SELECT * FROM tasks WHERE id=?',root);
  });
}
export function cancellable(db,root) {
  if(!root||root.kind!=='root'||!['approval_pending','planning','running'].includes(root.status))return false;
  const children=all(db,'SELECT kind,status FROM tasks WHERE parent_id=?',root.id);
  return children.length>0&&children.every(child=>child.status==='ready'||child.status==='blocked'||(child.kind==='plan'&&child.status==='completed'));
}
export function cancelTask(db,root,actor) {
  return transaction(db,()=>{
    const current=one(db,'SELECT * FROM tasks WHERE id=?',root.id);
    if(!cancellable(db,current))return false;
    const time=now();
    run(db,"UPDATE tasks SET status='cancelled',finished_at=? WHERE parent_id=? AND status IN ('ready','blocked')",time,root.id);
    run(db,"UPDATE tasks SET status='cancelled',finished_at=? WHERE id=?",time,root.id);
    event(db,root.id,actor,'cancelled','実行前に中止');
    return true;
  });
}
export function claim(db,device) {
  return transaction(db,()=>{
    const plannerOnline=one(db,'SELECT id FROM devices WHERE planner=1 AND revoked=0 AND last_seen>? LIMIT 1',now()-30000);
    const canPlan=!!device.planner||(!plannerOnline&&JSON.parse(device.capabilities||'[]').includes('planning'));
    const job=one(db,`SELECT * FROM tasks WHERE status='ready' AND ((kind='plan' AND ?=1) OR (kind='execute' AND (device_id=? OR device_id IS NULL))) ORDER BY CASE kind WHEN 'plan' THEN 0 ELSE 1 END,created_at LIMIT 1`,canPlan?1:0,device.id);
    if(!job) return null;
    const lease=id(),time=now();
    run(db,"UPDATE tasks SET status='running',device_id=?,lease_id=?,lease_until=?,attempts=attempts+1,started_at=CASE WHEN started_at=0 THEN ? ELSE started_at END WHERE id=?",device.id,lease,time+240000,time,job.id);
    event(db,job.id,device.label,'started','OpenClawへ依頼');
    return {...job,status:'running',lease_id:lease};
  });
}
export function sweep(db) {
  const expired=all(db,"SELECT * FROM tasks WHERE status='running' AND lease_until>0 AND lease_until<?",now());
  for(const task of expired) {
    if(task.kind==='plan'&&task.attempts<3) {run(db,"UPDATE tasks SET status='ready',lease_id=NULL,lease_until=0,device_id=NULL WHERE id=?",task.id);event(db,task.id,'system','retry','計画担当との接続が切れたため再試行');}
    else {run(db,"UPDATE tasks SET status='needs_review',error='担当端末との通信が途切れ、実行結果を確認できません',finished_at=?,lease_id=NULL WHERE id=?",now(),task.id);event(db,task.id,'system','needs_review','実行結果不明');if(task.kind==='execute') finishRoot(db,task.parent_id);if(task.kind==='plan')run(db,"UPDATE tasks SET status='needs_review',error='計画担当との通信が途切れました',finished_at=? WHERE id=?",now(),task.parent_id);}
  }
}
function parsePlan(raw,original,devices) {
  let parsed;
  try {parsed=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*|\s*```$/g,''));} catch {}
  if(!Array.isArray(parsed?.steps)||!parsed.steps.length) return [{text:original,department:'operations',device_id:null,kind:'execute'}];
  return parsed.steps.slice(0,12).map(step=>({
    text:String(step.prompt||step.title||original).slice(0,8000),
    department:departments.some(d=>d.id===step.department)?step.department:'operations',
    device_id:devices.some(d=>d.id===step.deviceId)?step.deviceId:null,
    kind:step.human===true?'human':'execute'
  }));
}
export function finishRoot(db,rootId) {
  if(!rootId) return;
  const steps=all(db,"SELECT * FROM tasks WHERE parent_id=? AND kind IN ('execute','human') ORDER BY created_at",rootId);
  if(!steps.length||steps.some(s=>!['completed','failed','needs_review','cancelled'].includes(s.status))) return;
  const status=steps.every(s=>s.status==='completed')?'completed':'needs_review';
  const result=steps.map((s,i)=>`${i+1}. ${s.status==='completed'?'完了':'要確認'}: ${(s.result||s.error).slice(0,1000)}`).join('\n');
  run(db,"UPDATE tasks SET status=?,result=?,finished_at=? WHERE id=? AND status IN ('planning','running')",status,result,now(),rootId);
  event(db,rootId,'rei',status,'子仕事の結果を集約');
}
export function finishJob(db,device,input) {
  const job=one(db,"SELECT * FROM tasks WHERE id=? AND device_id=? AND lease_id=? AND status='running'",input.taskId,device.id,input.leaseId);
  if(!job) return {ok:false,duplicate:true};
  const success=!!input.success,result=String(input.result||'').slice(0,100000),error=String(input.error||'').slice(0,4000);
  transaction(db,()=>{
    run(db,'UPDATE tasks SET status=?,result=?,error=?,finished_at=?,lease_until=0 WHERE id=?',success?'completed':'failed',result,error,now(),job.id);
    event(db,job.id,device.label,success?'completed':'failed',success?'結果を受信':error);
    if(job.kind==='plan') {
      if(!success) {run(db,"UPDATE tasks SET status='needs_review',error=?,finished_at=? WHERE id=?",error||'計画に失敗しました',now(),job.parent_id);return;}
      const root=one(db,'SELECT * FROM tasks WHERE id=?',job.parent_id);
      const devices=all(db,'SELECT id,label FROM devices WHERE revoked=0');
      const steps=parsePlan(result,root.text,devices);
      for(const step of steps) {
        const child=id();
        run(db,'INSERT INTO tasks(id,parent_id,kind,text,department,status,device_id,created_by,created_at,project_id) VALUES(?,?,?,?,?,?,?,?,?,?)',child,root.id,step.kind,step.text,step.department,step.kind==='human'?'waiting_human':'ready',step.device_id,root.created_by,now(),root.project_id);
        event(db,child,'rei','queued',step.kind==='human'?'人への依頼待ち':'端末へ割当');
      }
      run(db,"UPDATE tasks SET status='running',started_at=? WHERE id=?",now(),root.id);
      event(db,root.id,'rei','planned',`${steps.length}件に分解`);
    }
    if(job.kind==='execute') finishRoot(db,job.parent_id);
  });
  return {ok:true};
}
export function report(db) {
  const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const tasks=all(db,"SELECT * FROM tasks WHERE kind='root' ORDER BY created_at DESC").filter(t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t.created_at))===day);
  const count=status=>tasks.filter(t=>t.status===status).length;
  return {day,total:tasks.length,completed:count('completed'),running:count('running')+count('planning'),failed:count('failed'),interrupted:count('needs_review'),tasks:tasks.map(t=>({id:t.id,text:t.text,department:t.department,status:t.status,createdAt:new Date(t.created_at).toISOString(),summary:(t.result||t.error).slice(0,220)}))};
}
