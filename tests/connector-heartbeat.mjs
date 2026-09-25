import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=mkdtempSync(path.join(os.tmpdir(),'rei-heartbeat-'));
const bin=path.join(dir,'bin');mkdirSync(bin);
const fake=`#!/usr/bin/env node
const args=process.argv.slice(2);
if(args[0]==='mcp'&&args[1]==='list')console.log('{}');
else if(args[0]==='mcp'&&args[1]==='status')console.log('{"servers":[]}');
else if(args[0]==='agent')setTimeout(()=>console.log(JSON.stringify({status:'ok',result:{payloads:[{text:'done'}]}})),11500);
else process.exit(2);
`;
for(const name of ['openclaw','openclaw.mjs']){const file=path.join(bin,name);writeFileSync(file,fake);chmodSync(file,0o755);}
let heartbeats=0,claimed=false,reported=false;
const server=createServer((request,response)=>{
  const route=new URL(request.url,'http://localhost').searchParams.get('route');
  if(route==='connector/heartbeat')heartbeats++;
  const result=route==='connector/heartbeat'?{integrations:[],checks:[]}:
    route==='connector/claim'&&!claimed?(claimed=true,{job:{id:'test-task',kind:'execute',text:'接続確認',lease_id:'test-lease'},devices:[]}):
    route==='connector/claim'?{job:null,devices:[]}:
    route==='connector/renew'?{ok:true}:
    route==='connector/result'?(reported=true,{ok:true}):{error:'unknown route'};
  request.resume();response.writeHead(result.error?404:200,{'content-type':'application/json'});response.end(JSON.stringify(result));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const config=path.join(dir,'connector.json');
  writeFileSync(config,JSON.stringify({hub:`http://127.0.0.1:${server.address().port}`,token:'test-token',agent:'rei'}));
  const child=spawn(process.execPath,['connector.mjs','--once'],{cwd:root,env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,REI_OPENCLAW_ENTRY:path.join(bin,'openclaw.mjs'),REI_CONNECTOR_CONFIG:config},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const timer=setTimeout(()=>child.kill(),25000);
  const code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
  assert.equal(code,0,output);
  assert.equal(reported,true,output);
  assert.ok(heartbeats>=2,`実行中の心拍が不足しています: ${heartbeats}`);
  console.log('PASS connector stays online during a long job');
} finally {server.close();}
