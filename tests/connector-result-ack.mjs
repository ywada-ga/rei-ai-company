import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=mkdtempSync(path.join(os.tmpdir(),'rei-result-ack-'));
const pendingPath=path.join(dir,'pending-results.json');
const result={taskId:'task-1',leaseId:'lease-1',success:true,result:'実行済み',error:''};
writeFileSync(pendingPath,JSON.stringify([result]));
let accepted=false,claims=0,received=0;
const pendingCounts=[];
const server=createServer(async(request,response)=>{
  const route=new URL(request.url,'http://localhost').searchParams.get('route');
  let body='';for await(const chunk of request)body+=chunk;
  let payload;
  if(route==='connector/heartbeat') {pendingCounts.push(JSON.parse(body).pendingResults);payload={integrations:[],checks:[]};}
  else if(route==='connector/result') {received++;payload=accepted?{ok:true,alreadyRecorded:true}:{ok:false,duplicate:true};}
  else if(route==='connector/claim') {claims++;payload={job:null,devices:[]};}
  else payload={error:'unexpected route'};
  response.writeHead(payload.error?404:200,{'content-type':'application/json'});response.end(JSON.stringify(payload));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const config=path.join(dir,'connector.json');
  writeFileSync(config,JSON.stringify({hub:`http://127.0.0.1:${server.address().port}`,token:'test-token',agent:'rei'}));
  async function runOnce() {
    const child=spawn(process.execPath,['connector.mjs','--once'],{cwd:root,env:{...process.env,REI_CONNECTOR_CONFIG:config},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
    const code=await new Promise(resolve=>child.on('close',resolve));
    return {code,output};
  }
  const rejected=await runOnce();
  assert.notEqual(rejected.code,0,rejected.output);
  assert.match(rejected.output,/送信待ち記録を保持/);
  assert.deepEqual(JSON.parse(readFileSync(pendingPath,'utf8')),[result]);
  assert.equal(claims,0,'未照合の結果がある間は次の仕事を取得しない');

  accepted=true;
  const retried=await runOnce();
  assert.equal(retried.code,0,retried.output);
  assert.deepEqual(JSON.parse(readFileSync(pendingPath,'utf8')),[]);
  assert.equal(received,2);
  assert.deepEqual(pendingCounts,[1,1]);
  console.log('PASS rejected results remain queued until Hub acknowledges them');
} finally {server.close();}
