import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { one, all, run } from './storage.mjs';
import { event, finishRoot } from './workflow.mjs';

function key(root) {
  const file=path.join(process.env.REI_DATA_DIR||path.join(root,'data'),'chatwork.key');
  if(!existsSync(file)) writeFileSync(file,crypto.randomBytes(32),{mode:0o600,flag:'wx'});
  try{chmodSync(file,0o600);}catch{}
  return readFileSync(file);
}
function encrypt(root,value) {const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(root),iv),body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');}
function decrypt(root,value) {const bytes=Buffer.from(value,'base64'),cipher=crypto.createDecipheriv('aes-256-gcm',key(root),bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}
function config(db,root) {const room=one(db,"SELECT value FROM settings WHERE key='chatwork_room'")?.value,encoded=one(db,"SELECT value FROM settings WHERE key='chatwork_token'")?.value;return room&&encoded?{room,token:decrypt(root,encoded)}:null;}
export function chatworkStatus(db) {const room=one(db,"SELECT value FROM settings WHERE key='chatwork_room'")?.value;return {configured:!!room,roomId:room||null,pending:one(db,"SELECT count(*) AS n FROM tasks WHERE kind='human' AND status='waiting_human'")?.n||0};}
export function configureChatwork(db,root,roomId,token) {if(!/^\d+$/.test(roomId))throw Object.assign(new Error('ChatworkのルームIDは数字です'),{status:400});run(db,"INSERT INTO settings(key,value) VALUES('chatwork_room',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",roomId);run(db,"INSERT INTO settings(key,value) VALUES('chatwork_token',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",encrypt(root,token));return {configured:true,roomId};}
export async function sendPendingHuman(db,root) {
  const cfg=config(db,root);if(!cfg)return;
  const pending=all(db,"SELECT * FROM tasks WHERE kind='human' AND status='waiting_human' ORDER BY created_at LIMIT 5");
  for(const task of pending) {
    if(!run(db,"UPDATE tasks SET status='sending' WHERE id=? AND status='waiting_human'",task.id).changes)continue;
    const message=`[REI:${task.id}]\n依頼: ${task.text}\n回答するときはこの [REI:${task.id}] を含めてください。`;
    try {
      const response=await fetch(`https://api.chatwork.com/v2/rooms/${cfg.room}/messages`,{method:'POST',headers:{'x-chatworktoken':cfg.token,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({body:message}),signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error(`Chatwork HTTP ${response.status}`);
      const data=await response.json();
      run(db,"INSERT OR IGNORE INTO external_messages(id,task_id,direction,body,created_at) VALUES(?,?,?,?,?)",String(data.message_id),task.id,'out',message,Date.now());
      run(db,"UPDATE tasks SET status='waiting_reply' WHERE id=?",task.id);
      event(db,task.id,'chatwork','sent',String(data.message_id));
    } catch(e) {
      run(db,"UPDATE tasks SET status='needs_review',error=?,finished_at=? WHERE id=?",`Chatwork送信結果を確認できません: ${e.message}`,Date.now(),task.id);
      event(db,task.id,'chatwork','needs_review',e.message);
      finishRoot(db,task.parent_id);
    }
  }
}
export async function pollChatwork(db,root) {
  const cfg=config(db,root);if(!cfg)return {configured:false,received:0};
  const response=await fetch(`https://api.chatwork.com/v2/rooms/${cfg.room}/messages?force=1`,{headers:{'x-chatworktoken':cfg.token},signal:AbortSignal.timeout(15000)});
  if(response.status===204)return {configured:true,received:0};
  if(!response.ok)throw new Error(`Chatwork取得 HTTP ${response.status}`);
  const messages=await response.json();let received=0;
  for(const message of messages) {
    const externalId=String(message.message_id||'');
    if(!externalId||one(db,'SELECT id FROM external_messages WHERE id=?',externalId))continue;
    const body=String(message.body||''),taskId=body.match(/\[REI:([0-9a-f-]{36})\]/i)?.[1];
    if(!taskId)continue;
    const task=one(db,"SELECT * FROM tasks WHERE id=? AND kind='human' AND status='waiting_reply'",taskId);
    if(!task)continue;
    run(db,'INSERT OR IGNORE INTO external_messages(id,task_id,direction,body,created_at) VALUES(?,?,?,?,?)',externalId,task.id,'in',body,Date.now());
    run(db,"UPDATE tasks SET status='completed',result=?,finished_at=? WHERE id=?",body.slice(0,100000),Date.now(),task.id);
    event(db,task.id,'chatwork','reply',externalId);
    finishRoot(db,task.parent_id);received++;
  }
  return {configured:true,received};
}
