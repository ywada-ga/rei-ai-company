import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openStorage, one, run } from '../storage.mjs';
import { configureChatwork, sendPendingHuman, pollChatwork } from '../chatwork.mjs';
import { sweep } from '../workflow.mjs';
const dir=mkdtempSync(path.join(os.tmpdir(),'rei-chatwork-'));
process.env.REI_DATA_DIR=dir;
const db=openStorage(dir),root='00000000-0000-4000-8000-000000000001',child='00000000-0000-4000-8000-000000000002';
run(db,"INSERT INTO tasks(id,kind,text,status,created_at) VALUES(?,?,?,?,?)",root,'root','人に確認','running',Date.now());
run(db,"INSERT INTO tasks(id,parent_id,kind,text,status,created_at) VALUES(?,?,?,?,?,?)",child,root,'human','今日の状況を教えてください','waiting_human',Date.now());
configureChatwork(db,dir,'12345','test-token',77);
let posted='';
globalThis.fetch=async(url,opts)=>{
  if(opts?.method==='POST'){posted=String(opts.body);return {ok:true,json:async()=>({message_id:'1'})};}
  return {ok:true,status:200,json:async()=>[{message_id:'1',body:'original',account:{account_id:77}},{message_id:'2',body:`[REI:${child}]\n本日は順調です`,account:{account_id:88}}]};
};
await sendPendingHuman(db,dir);
assert.match(posted,/REI%3A/);
assert.equal(one(db,'SELECT status FROM tasks WHERE id=?',child).status,'waiting_reply');
const result=await pollChatwork(db,dir);
assert.equal(result.received,1);
assert.equal(one(db,'SELECT status FROM tasks WHERE id=?',root).status,'completed');
const nextRoot='00000000-0000-4000-8000-000000000003',nextChild='00000000-0000-4000-8000-000000000004';
run(db,"INSERT INTO tasks(id,kind,text,status,created_at) VALUES(?,?,?,?,?)",nextRoot,'root','次の人に確認','running',Date.now());
run(db,"INSERT INTO tasks(id,parent_id,kind,text,status,created_at) VALUES(?,?,?,?,?,?)",nextChild,nextRoot,'human','次の状況を教えてください','waiting_human',Date.now());
const ambiguousRoot='00000000-0000-4000-8000-00000000000b',ambiguousChild='00000000-0000-4000-8000-00000000000c';
run(db,"INSERT INTO tasks(id,kind,text,status,created_at) VALUES(?,?,?,?,?)",ambiguousRoot,'root','別の人への確認','running',Date.now());
run(db,"INSERT INTO tasks(id,parent_id,kind,text,status,created_at) VALUES(?,?,?,?,?,?)",ambiguousChild,ambiguousRoot,'human','別件の回答','waiting_reply',Date.now());
const waitingRoot='00000000-0000-4000-8000-00000000000d',waitingChild='00000000-0000-4000-8000-00000000000e';
run(db,"INSERT INTO tasks(id,kind,text,status,created_at) VALUES(?,?,?,?,?)",waitingRoot,'root','もう一件の確認','running',Date.now());
run(db,"INSERT INTO tasks(id,parent_id,kind,text,status,created_at) VALUES(?,?,?,?,?,?)",waitingChild,waitingRoot,'human','別件の回答','waiting_reply',Date.now());
globalThis.fetch=async()=>({ok:true,status:200,json:async()=>[{message_id:'3',body:`[REI:${ambiguousChild}] と [REI:${waitingChild}] の両方について`,account:{account_id:88}}]});
assert.equal((await pollChatwork(db,dir)).received,0);
assert.equal(one(db,'SELECT status FROM tasks WHERE id=?',ambiguousChild).status,'waiting_reply');
assert.equal(one(db,'SELECT status FROM tasks WHERE id=?',waitingChild).status,'waiting_reply');
let sent=0;
globalThis.fetch=async()=>{sent++;await new Promise(resolve=>setTimeout(resolve,10));return {ok:true,json:async()=>({message_id:'5'})};};
await Promise.all([sendPendingHuman(db,dir),sendPendingHuman(db,dir)]);
assert.equal(sent,1);
const crashedRoot='00000000-0000-4000-8000-000000000005',crashedChild='00000000-0000-4000-8000-000000000006';
run(db,"INSERT INTO tasks(id,kind,text,status,created_at) VALUES(?,?,?,?,?)",crashedRoot,'root','送信中断の確認','running',Date.now()-120000);
run(db,"INSERT INTO tasks(id,parent_id,kind,text,status,created_at) VALUES(?,?,?,?,?,?)",crashedChild,crashedRoot,'human','送信中の仕事','sending',Date.now()-120000);
sweep(db);
assert.equal(one(db,'SELECT status FROM tasks WHERE id=?',crashedChild).status,'needs_review');
assert.equal(one(db,'SELECT status FROM tasks WHERE id=?',crashedRoot).status,'needs_review');
assert.equal(sent,1);
run(db,"DELETE FROM settings WHERE key='chatwork_account_id'");
let identityChecks=0;
globalThis.fetch=async url=>{
  if(String(url).endsWith('/me')){identityChecks++;return {ok:true,json:async()=>({account_id:77})};}
  return {ok:true,status:200,json:async()=>[{message_id:'8',body:`[REI:${nextChild}] 人からの回答`,account:{account_id:88}}]};
};
assert.equal((await pollChatwork(db,dir)).received,1);
assert.equal(identityChecks,1);
assert.equal(one(db,"SELECT value FROM settings WHERE key='chatwork_account_id'").value,'77');
const ownRoot='00000000-0000-4000-8000-000000000007',ownChild='00000000-0000-4000-8000-000000000008';
run(db,"INSERT INTO tasks(id,kind,text,status,created_at) VALUES(?,?,?,?,?)",ownRoot,'root','自分の投稿は回答にしない','running',Date.now());
run(db,"INSERT INTO tasks(id,parent_id,kind,text,status,created_at) VALUES(?,?,?,?,?,?)",ownChild,ownRoot,'human','担当者へ依頼','waiting_reply',Date.now());
globalThis.fetch=async()=>({ok:true,status:200,json:async()=>[
  {message_id:'6',body:`[REI:${ownChild}] 自分の投稿`,account:{account_id:77}},
  {message_id:'7',body:`[REI:${ownChild}] 投稿者不明`}
]});
assert.equal((await pollChatwork(db,dir)).received,0);
assert.equal(one(db,'SELECT status FROM tasks WHERE id=?',ownChild).status,'waiting_reply');
const badRoot='00000000-0000-4000-8000-000000000009',badChild='00000000-0000-4000-8000-00000000000a';
run(db,"INSERT INTO tasks(id,kind,text,status,created_at) VALUES(?,?,?,?,?)",badRoot,'root','投稿ID不明','running',Date.now());
run(db,"INSERT INTO tasks(id,parent_id,kind,text,status,created_at) VALUES(?,?,?,?,?,?)",badChild,badRoot,'human','送信結果を照合','waiting_human',Date.now());
globalThis.fetch=async()=>({ok:true,json:async()=>({})});
await sendPendingHuman(db,dir);
assert.equal(one(db,'SELECT status FROM tasks WHERE id=?',badChild).status,'needs_review');
assert.equal(one(db,'SELECT status FROM tasks WHERE id=?',badRoot).status,'needs_review');
console.log('PASS Chatwork send/reply correlation');
