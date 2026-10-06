import { one, all, run } from './storage.mjs';
import { createKnowledgeTask } from './workflow.mjs';
import { knowledgeSettings, scanQuestion } from './intelligence.mjs';

export function knowledgeDevice(db,version,time=Date.now()) {
  return all(db,"SELECT DISTINCT d.id,d.label,d.capabilities FROM devices d JOIN mcp_integrations m ON m.device_id=d.id JOIN device_mcp_status s ON s.device_id=d.id AND s.name=m.name WHERE d.revoked=0 AND d.last_seen>? AND d.version=? AND m.url='https://mcp.synapse-connect.ai/mcp' AND s.status='configured' ORDER BY d.planner DESC,d.rowid",time-30000,version).find(device=>JSON.parse(device.capabilities).includes('execution'))||null;
}
export function queueKnowledge(db,version,mode,question,userId,time=Date.now()) {
  const device=knowledgeDevice(db,version,time);
  if(!device)throw Object.assign(new Error('SynapseConnectを登録済みの実行端末が接続していません。端末・設定で接続を確認してください'),{status:409});
  const settings=knowledgeSettings(db);
  if(mode!=='catalog'&&!settings.groups.length)throw Object.assign(new Error('「共有グループを確認」から検索する会社のグループを選んで保存してください'),{status:409});
  if(one(db,"SELECT id FROM tasks WHERE kind='root' AND knowledge_mode=? AND status='running'",mode))throw Object.assign(new Error('同じ種類の確認が進行中です。結果を待ってください'),{status:409});
  return createKnowledgeTask(db,question,mode,userId,device.id,mode==='catalog'?[]:settings.groups,time);
}
export function scanKnowledgeIfDue(db,version,time=Date.now()) {
  const settings=knowledgeSettings(db);
  if(!settings.enabled||!settings.groups.length||settings.nextRunAt>time||!knowledgeDevice(db,version,time))return null;
  if(!one(db,"SELECT id FROM users WHERE id=? AND role='owner' AND disabled=0",settings.configuredBy))return null;
  if(one(db,"SELECT id FROM tasks WHERE kind='root' AND knowledge_mode='scan' AND status='running'"))return null;
  const latest=one(db,"SELECT created_at FROM tasks WHERE kind='root' AND knowledge_mode='scan' ORDER BY created_at DESC LIMIT 1");
  if(latest&&latest.created_at+settings.intervalHours*3600000>time)return null;
  const task=queueKnowledge(db,version,'scan',scanQuestion,settings.configuredBy,time);
  // If interrupted before this update, the persisted task still prevents a duplicate run.
  settings.nextRunAt=time+settings.intervalHours*3600000;
  run(db,"UPDATE settings SET value=? WHERE key='company_intelligence'",JSON.stringify(settings));
  return task;
}
