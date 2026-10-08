import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync} from 'node:fs';
import {createServer} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {openStorage,run} from '../storage.mjs';
import {encodePassword,hash} from '../security.mjs';
import {createTask} from '../workflow.mjs';
const root=path.resolve('.'),data=mkdtempSync(path.join(os.tmpdir(),'rei-cowork-api-'));
process.env.REI_DATA_DIR=data;const db=openStorage(root),password=await encodePassword('fixture-only-password');
for(const role of ['owner','viewer']){run(db,'INSERT INTO users(id,username,salt,digest,role) VALUES(?,?,?,?,?)',role,role,password.salt,password.digest,role);run(db,'INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)',hash(`fixture-${role}`),role,Date.now()+60000);}
const task=createTask(db,'接続テスト。外部サービスへ送信しない','operations','owner',true);db.close();
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const hub=spawn(process.execPath,['hub.mjs'],{cwd:root,env:{...process.env,REI_PORT:String(port)},stdio:['ignore','pipe','pipe']});let ready='';hub.stdout.on('data',c=>ready+=c);
const api=async(route,body,role='owner')=>{const response=await fetch(`http://127.0.0.1:${port}/api?route=${route}`,{method:body?'POST':'GET',headers:{cookie:`rei_session=fixture-${role}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,response};};
let bridge;
try{
 for(let n=0;n<100&&!ready.includes('REI Hub:');n++)await new Promise(r=>setTimeout(r,50));assert.ok(ready.includes('REI Hub:'));
 assert.equal((await api('cowork/status',null,'viewer')).status,403);
 assert.equal((await api('cowork/approve',{taskId:task.id},'viewer')).status,403);
 assert.equal((await api('cowork/approve',{taskId:task.id})).status,409);
 if(process.platform==='darwin'){
  assert.equal((await api('cowork/prepare',{})).status,200);
  assert.equal((await api('cowork/plugin',null,'viewer')).status,403);
  const zip=await api('cowork/plugin');assert.equal(zip.status,200);assert.equal(zip.response.headers.get('content-type'),'application/zip');assert.ok((await zip.response.arrayBuffer()).byteLength>0);
 }else{
  // The platform-specific package builder is deliberately unsupported here.
  console.log('Cowork API role guards passed; Mac package route checked in Mac CI');
  process.exitCode=0;
 }
 if(process.platform==='darwin'){
  assert.equal((await api('cowork/approve',{taskId:task.id})).status,200);
  assert.notEqual((await api('cowork/approve',{taskId:task.id})).status,200);
  bridge=spawn(process.execPath,['cowork-mcp.mjs','--data-dir',data],{cwd:root,stdio:['pipe','pipe','pipe']});const lines=createInterface({input:bridge.stdout});let seq=0;const pending=new Map();lines.on('line',l=>{const m=JSON.parse(l);pending.get(m.id)?.(m);pending.delete(m.id);});const rpc=(method,params={})=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);bridge.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  await rpc('initialize',{protocolVersion:'2025-03-26'});
  const list=await rpc('tools/call',{name:'rei_list_jobs',arguments:{}}),job=JSON.parse(list.result.content[0].text)[0];
  const taken=await rpc('tools/call',{name:'rei_claim_job',arguments:{taskId:job.id}}),receipt=JSON.parse(taken.result.content[0].text).receipt;
  await rpc('tools/call',{name:'rei_report_result',arguments:{taskId:job.id,receipt,summary:'接続確認完了。外部送信なし。'}});
  const taskResponse=await fetch(`http://127.0.0.1:${port}/api?route=tasks/detail/${task.id}`,{headers:{cookie:'rei_session=fixture-owner'}});const taskDetail=await taskResponse.json();
  assert.equal(taskDetail.task.status,'needs_review');
  assert.equal((await api('tasks/reconcile',{taskId:job.id,resolution:'completed',note:'結果を確認しました'})).status,200);
  const checked=await fetch(`http://127.0.0.1:${port}/api?route=tasks/detail/${task.id}`,{headers:{cookie:'rei_session=fixture-owner'}});assert.equal((await checked.json()).task.status,'completed');
  lines.close();console.log('Cowork API authorization, package, approval → MCP → review flow passed');
 }
}finally{bridge?.stdin.end();bridge?.kill();hub.kill();delete process.env.REI_DATA_DIR;}
