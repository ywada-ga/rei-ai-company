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
export function retryPlan(db,rootId,actor) {
  return transaction(db,()=>{
    const root=one(db,"SELECT id,status FROM tasks WHERE id=? AND kind='root'",rootId);
    if(root?.status!=='needs_review')return false;
    const children=all(db,'SELECT id,kind,status FROM tasks WHERE parent_id=?',rootId);
    if(children.length!==1||children[0].kind!=='plan'||!['failed','needs_review'].includes(children[0].status))return false;
    const plan=children[0];
    run(db,"UPDATE tasks SET status='ready',device_id=NULL,lease_id=NULL,lease_until=0,attempts=0,result='',error='',finished_at=0 WHERE id=?",plan.id);
    run(db,"UPDATE tasks SET status='planning',result='',error='',finished_at=0 WHERE id=?",rootId);
    event(db,rootId,actor,'plan_retried','計画を再実行');
    return true;
  });
}
export function claim(db,device,hubVersion='') {
  return transaction(db,()=>{
    const plannerOnline=all(db,"SELECT capabilities FROM devices WHERE planner=1 AND revoked=0 AND last_seen>? AND version=?",now()-30000,hubVersion).some(candidate=>JSON.parse(candidate.capabilities||'[]').includes('planning'));
    const capabilities=JSON.parse(device.capabilities||'[]');
    const canPlan=capabilities.includes('planning')&&(!!device.planner||!plannerOnline);
    const canExecute=capabilities.includes('execution');
    const job=one(db,`SELECT * FROM tasks WHERE status='ready' AND ((kind='plan' AND ?=1) OR (kind='execute' AND ?=1 AND (device_id=? OR device_id IS NULL))) ORDER BY CASE kind WHEN 'plan' THEN 0 ELSE 1 END,created_at LIMIT 1`,canPlan?1:0,canExecute?1:0,device.id);
    if(!job) return null;
    const lease=id(),time=now();
    run(db,"UPDATE tasks SET status='running',device_id=?,lease_id=?,lease_until=?,attempts=attempts+1,started_at=CASE WHEN started_at=0 THEN ? ELSE started_at END WHERE id=?",device.id,lease,time+240000,time,job.id);
    event(db,job.id,device.label,'started','OpenClawへ依頼');
    return {...job,status:'running',lease_id:lease};
  });
}
export function sweep(db) {
  return transaction(db,()=>{
    const uncertainHuman=all(db,"SELECT * FROM tasks WHERE kind='human' AND status='sending' AND COALESCE((SELECT MAX(e.created_at) FROM events e WHERE e.task_id=tasks.id AND e.type='sending'),created_at)<?",now()-60000);
    for(const task of uncertainHuman) {
      run(db,"UPDATE tasks SET status='needs_review',error='Chatworkへの送信結果が不明です。ルームを確認してください',finished_at=? WHERE id=? AND status='sending'",now(),task.id);
      event(db,task.id,'system','needs_review','Chatwork送信中に処理が中断');
      finishRoot(db,task.parent_id);
    }
    const expired=all(db,"SELECT * FROM tasks WHERE status='running' AND lease_until>0 AND lease_until<?",now());
    for(const task of expired) {
      if(task.kind==='plan'&&task.attempts<3) {run(db,"UPDATE tasks SET status='ready',lease_id=NULL,lease_until=0,device_id=NULL WHERE id=?",task.id);event(db,task.id,'system','retry','計画担当との接続が切れたため再試行');}
      else {run(db,"UPDATE tasks SET status='needs_review',error='担当端末との通信が途切れ、実行結果を確認できません',finished_at=?,lease_id=CASE WHEN kind='execute' THEN lease_id ELSE NULL END WHERE id=?",now(),task.id);event(db,task.id,'system','needs_review','実行結果不明');if(task.kind==='execute') finishRoot(db,task.parent_id);if(task.kind==='plan')run(db,"UPDATE tasks SET status='needs_review',error='計画担当との通信が途切れました',finished_at=? WHERE id=?",now(),task.parent_id);}
    }
  });
}
function parsePlan(raw,devices) {
  let parsed;
  try {parsed=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*|\s*```$/g,''));} catch {}
  if(!Array.isArray(parsed?.steps)||!parsed.steps.length||parsed.steps.length>12||parsed.steps.some(step=>{
    if(!step||typeof step!=='object')return true;
    const prompt=step.prompt||step.title;
    return typeof prompt!=='string'||!prompt.trim()||prompt.length>8000||(step.deviceId!=null&&step.deviceId!==''&&!devices.some(device=>device.id===step.deviceId));
  }))return null;
  return parsed.steps.map(step=>({
    text:(step.prompt||step.title).trim(),
    department:departments.some(d=>d.id===step.department)?step.department:'operations',
    device_id:step.deviceId||null,
    kind:step.human===true?'human':'execute'
  }));
}
export function finishRoot(db,rootId) {
  if(!rootId) return;
  const steps=all(db,"SELECT * FROM tasks WHERE parent_id=? AND kind IN ('execute','human') ORDER BY created_at",rootId);
  if(!steps.length||steps.some(s=>!['completed','failed','needs_review','cancelled'].includes(s.status))) return;
  const status=steps.every(s=>s.status==='completed')?'completed':'needs_review';
  const result=steps.map((s,i)=>`${i+1}. ${s.status==='completed'?'完了':'要確認'}: ${(s.result||s.error).slice(0,1000)}`).join('\n');
  run(db,"UPDATE tasks SET status=?,result=?,error='',finished_at=? WHERE id=? AND status IN ('planning','running','needs_review')",status,result,now(),rootId);
  event(db,rootId,'rei',status,'子仕事の結果を集約');
}
export function finishJob(db,device,input) {
  const result=String(input.result||'').slice(0,100000);
  const lateResult=(input.success?result:String(input.error||'').slice(0,4000))||'端末から結果が返りましたが、内容は空でした';
  const lateFingerprint=crypto.createHash('sha256').update(JSON.stringify([!!input.success,lateResult])).digest('hex');
  const job=one(db,'SELECT * FROM tasks WHERE id=? AND device_id=? AND lease_id=?',input.taskId,device.id,input.leaseId);
  if(!job) {
    const receipt=one(db,'SELECT r.fingerprint FROM late_result_receipts r JOIN tasks t ON t.id=r.task_id WHERE r.task_id=? AND r.lease_id=? AND t.device_id=?',input.taskId,input.leaseId,device.id);
    return receipt?.fingerprint===lateFingerprint?{ok:true,alreadyRecorded:true}:{ok:false,duplicate:true};
  }
  if(job.kind==='execute') {
    const receipt=one(db,'SELECT fingerprint FROM late_result_receipts WHERE task_id=?',job.id);
    if(receipt)return receipt.fingerprint===lateFingerprint?{ok:true,needsReview:job.status==='needs_review',alreadyRecorded:true}:{ok:false,duplicate:true};
    if(one(db,"SELECT id FROM events WHERE task_id=? AND type='late_result' LIMIT 1",job.id))return job.result===lateResult?{ok:true,needsReview:job.status==='needs_review',alreadyRecorded:true}:{ok:false,duplicate:true};
  }
  if(job.status==='needs_review'&&job.kind==='execute') {
    transaction(db,()=>{
      run(db,'UPDATE tasks SET result=? WHERE id=?',lateResult,job.id);
      run(db,'INSERT INTO late_result_receipts(task_id,lease_id,fingerprint,report,success) VALUES(?,?,?,?,?)',job.id,job.lease_id,lateFingerprint,lateResult,input.success?1:0);
      event(db,job.id,device.label,'late_result','通信断の後に結果を受信。実施状況の確認が必要');
    });
    return {ok:true,needsReview:true};
  }
  if(job.kind==='execute'&&['completed','failed'].includes(job.status)&&one(db,"SELECT id FROM events WHERE task_id=? AND type='reconciled' LIMIT 1",job.id)) {
    transaction(db,()=>{
      run(db,'INSERT INTO late_result_receipts(task_id,lease_id,fingerprint,report,success) VALUES(?,?,?,?,?)',job.id,job.lease_id,lateFingerprint,lateResult,input.success?1:0);
      run(db,"UPDATE tasks SET status='needs_review',result=?,error='端末から遅れて結果が届きました。確認結果と照合してください' WHERE id=?",job.result||job.error,job.id);
      run(db,"UPDATE tasks SET status='needs_review',error='確認後に端末から結果が届きました',finished_at=? WHERE id=?",now(),job.parent_id);
      event(db,job.id,device.label,'late_result','確認後に端末から結果を受信。再確認が必要');
    });
    return {ok:true,needsReview:true};
  }
  if(job.status!=='running') {
    const sameResult=job.result===result;
    const sameOutcome=job.status==='completed'?!!input.success:job.status==='failed'&&(!!input.success&&job.kind==='plan'||!input.success&&job.error===String(input.error||'').slice(0,4000));
    return sameResult&&sameOutcome?{ok:true,alreadyRecorded:true}:{ok:false,duplicate:true};
  }
  const devices=job.kind==='plan'?all(db,'SELECT id,label FROM devices WHERE revoked=0'):[];
  const steps=job.kind==='plan'&&input.success?parsePlan(result,devices):null;
  const success=!!input.success&&(job.kind!=='plan'||!!steps);
  const error=success?'':job.kind==='plan'&&input.success&&!steps?'計画の形式または担当PCを確認できませんでした。計画だけ再実行してください':String(input.error||'').slice(0,4000);
  transaction(db,()=>{
    run(db,'UPDATE tasks SET status=?,result=?,error=?,finished_at=?,lease_until=0 WHERE id=?',success?'completed':'failed',result,error,now(),job.id);
    event(db,job.id,device.label,success?'completed':'failed',success?'結果を受信':error);
    if(job.kind==='plan') {
      if(!success) {run(db,"UPDATE tasks SET status='needs_review',error=?,finished_at=? WHERE id=?",error||'計画に失敗しました',now(),job.parent_id);return;}
      const root=one(db,'SELECT * FROM tasks WHERE id=?',job.parent_id);
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
  const start=new Date(`${day}T00:00:00+09:00`).getTime(),end=start+86400000;
  const tasks=all(db,"SELECT * FROM tasks WHERE kind='root' AND ((created_at>=? AND created_at<?) OR (finished_at>=? AND finished_at<?) OR status IN ('running','planning')) ORDER BY MAX(created_at,finished_at) DESC",start,end,start,end);
  const backlogWhere="kind='root' AND status='needs_review' AND created_at<? AND finished_at<?";
  const attentionBacklog={
    total:one(db,`SELECT COUNT(*) AS count FROM tasks WHERE ${backlogWhere}`,start,start).count,
    tasks:all(db,`SELECT id,text,error,result,created_at,finished_at FROM tasks WHERE ${backlogWhere} ORDER BY MAX(created_at,finished_at) DESC LIMIT 10`,start,start).map(task=>({id:task.id,text:task.text,activityAt:new Date(Math.max(task.created_at,task.finished_at)).toISOString(),summary:(task.result||task.error).slice(0,220)}))
  };
  const count=status=>tasks.filter(t=>t.status===status).length;
  const devices=all(db,`SELECT d.id,d.label,d.revoked,COUNT(t.id) AS total,
    COALESCE(SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END),0) AS completed,
    COALESCE(SUM(CASE WHEN t.status='running' THEN 1 ELSE 0 END),0) AS running,
    COALESCE(SUM(CASE WHEN t.status IN ('failed','needs_review') THEN 1 ELSE 0 END),0) AS attention
    FROM devices d LEFT JOIN tasks t ON t.device_id=d.id AND t.kind IN ('plan','execute') AND ((t.started_at>=? AND t.started_at<?) OR (t.finished_at>=? AND t.finished_at<?) OR t.status='running')
    GROUP BY d.id ORDER BY d.rowid`,start,end,start,end);
  const people=one(db,`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) AS completed,
    COALESCE(SUM(CASE WHEN status IN ('waiting_human','waiting_reply','sending') THEN 1 ELSE 0 END),0) AS waiting,
    COALESCE(SUM(CASE WHEN status='needs_review' THEN 1 ELSE 0 END),0) AS attention
    FROM tasks WHERE kind='human' AND ((created_at>=? AND created_at<?) OR (finished_at>=? AND finished_at<?) OR status IN ('waiting_human','waiting_reply','sending'))`,start,end,start,end);
  return {day,total:tasks.length,completed:count('completed'),running:count('running')+count('planning'),failed:count('failed'),interrupted:count('needs_review'),attentionBacklog,devices,people,tasks:tasks.map(t=>({id:t.id,text:t.text,department:t.department,status:t.status,createdAt:new Date(t.created_at).toISOString(),activityAt:new Date(Math.max(t.created_at,t.finished_at)).toISOString(),summary:(t.result||t.error).slice(0,220)}))};
}
