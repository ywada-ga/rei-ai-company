import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {openStorage,run,one} from '../storage.mjs';
import {createTask,claim,cancelTask,cancellable,finishRoot} from '../workflow.mjs';
import {approveCowork,listCowork,claimCowork,reportCowork} from '../cowork.mjs';
import {prepareCoworkPlugin} from '../cowork-plugin.mjs';
const folder=mkdtempSync(path.join(os.tmpdir(),'rei-cowork-')),root=path.resolve('.');
const prior=process.env.REI_DATA_DIR;process.env.REI_DATA_DIR=folder;const db=openStorage(root);
run(db,"INSERT INTO users(id,username,salt,digest,role) VALUES('user','owner','','','owner')");
run(db,"INSERT INTO devices(id,label,token_hash,capabilities) VALUES('device','OpenClaw','test','[\"planning\",\"execution\"]')");
const draft=createTask(db,'テスト資料を作成して','operations','user',true);
assert.deepEqual(listCowork(db),[]);
assert.throws(()=>approveCowork(db,'missing','owner'));
approveCowork(db,draft.id,'owner');assert.throws(()=>approveCowork(db,draft.id,'owner'));
assert.equal(claim(db,{id:'device',label:'OpenClaw',capabilities:'["planning","execution"]'}),null);
const job=listCowork(db)[0];assert.equal(job.status,'cowork_waiting');
const receipt=claimCowork(db,job.id);assert.throws(()=>claimCowork(db,job.id));
assert.throws(()=>reportCowork(db,{taskId:job.id,receipt:'bad',summary:'done'}));
reportCowork(db,{taskId:job.id,receipt:receipt.receipt,summary:'テストの成果を作成。送信は未実施。'});
assert.equal(one(db,'SELECT status FROM tasks WHERE id=?',draft.id).status,'needs_review');
assert.equal(reportCowork(db,{taskId:job.id,receipt:receipt.receipt,summary:'テストの成果を作成。送信は未実施。'}).duplicate,true);
assert.throws(()=>reportCowork(db,{taskId:job.id,receipt:receipt.receipt,summary:'違う報告'}));
run(db,"UPDATE tasks SET status='completed' WHERE id=?",job.id);finishRoot(db,draft.id);assert.equal(one(db,'SELECT status FROM tasks WHERE id=?',draft.id).status,'completed');
const cancelled=createTask(db,'中止テスト','operations','user',true);approveCowork(db,cancelled.id,'owner');assert.equal(cancellable(db,one(db,'SELECT * FROM tasks WHERE id=?',cancelled.id)),true);cancelTask(db,{id:cancelled.id},'owner');assert.equal(listCowork(db).length,0);
const protocolTask=createTask(db,'接続確認だけ。外部操作なし','operations','user',true);approveCowork(db,protocolTask.id,'owner');const protocolJob=listCowork(db)[0];
const child=spawn(process.execPath,['cowork-mcp.mjs','--data-dir',folder],{cwd:root,stdio:['pipe','pipe','pipe']});let next=0;const pending=new Map();
const lines=createInterface({input:child.stdout});lines.on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r);pending.delete(r.id);});
const rpc=(method,params={})=>new Promise(resolve=>{const id=++next;pending.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
try{
 const init=await rpc('initialize',{protocolVersion:'2025-03-26'});assert.equal(init.result.serverInfo.name,'rei-cowork');
 assert.equal((await rpc('tools/list')).result.tools.length,3);
 const denied=await rpc('tools/call',{name:'rei_claim_job',arguments:{taskId:protocolJob.id,command:'delete'}});assert.equal(denied.result.isError,true);
 const claimed=await rpc('tools/call',{name:'rei_claim_job',arguments:{taskId:protocolJob.id}});const payload=JSON.parse(claimed.result.content[0].text);assert.equal(payload.instruction,'接続確認だけ。外部操作なし');
 assert.equal((await rpc('tools/call',{name:'rei_claim_job',arguments:{taskId:protocolJob.id}})).result.isError,true);
 const reported=await rpc('tools/call',{name:'rei_report_result',arguments:{taskId:protocolJob.id,receipt:payload.receipt,summary:'接続テスト完了。外部操作なし。'}});assert.equal(reported.result.isError,undefined);
 if(process.platform==='darwin'){
  const zip=prepareCoworkPlugin(root,folder);assert.ok(readFileSync(zip).length>0);
  const config=JSON.parse(readFileSync(path.join(folder,'cowork-plugin/.mcp.json'),'utf8'));assert.equal(config.mcpServers['rei-local'].command,process.execPath);assert.equal(JSON.stringify(config).includes('token'),false);
  assert.equal(spawnSync('/usr/bin/unzip',['-t',zip]).status,0);
 }
 console.log('Cowork approval, isolation, single claim, report review, cancellation, MCP and package tests passed');
}finally{child.stdin.end();lines.close();child.kill();db.close();if(prior===undefined)delete process.env.REI_DATA_DIR;else process.env.REI_DATA_DIR=prior;}
