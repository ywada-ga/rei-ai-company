import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=mkdtempSync(path.join(os.tmpdir(),'rei-result-text-'));
const bin=path.join(dir,'bin');mkdirSync(bin);
const expected=`あ${'漢'.repeat(110000)}終`;
const fake=`#!/usr/bin/env node
const args=process.argv.slice(2);
if(args[0]==='mcp'&&args[1]==='list')console.log('{}');
else if(args[0]==='mcp'&&args[1]==='status')console.log('{"servers":[]}');
else if(args[0]==='agent'){
  const text='あ'+'漢'.repeat(110000)+'終';
  const output=Buffer.from(JSON.stringify({status:'ok',result:{payloads:[{text}]}}));
  process.stdout.write(output.subarray(0,output.indexOf(Buffer.from('あ'))+1));
  setTimeout(()=>process.stdout.write(output.subarray(output.indexOf(Buffer.from('あ'))+1)),20);
} else process.exit(2);
`;
for(const name of ['openclaw','openclaw.mjs']) {const file=path.join(bin,name);writeFileSync(file,fake);chmodSync(file,0o755);}
let claimed=false,received;
const server=createServer(async(request,response)=>{
  const route=new URL(request.url,'http://localhost').searchParams.get('route');
  const chunks=[];for await(const chunk of request)chunks.push(chunk);
  if(route==='connector/result')received=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const payload=route==='connector/heartbeat'?{integrations:[],checks:[]}:
    route==='connector/claim'&&!claimed?(claimed=true,{job:{id:'task-utf8',kind:'execute',text:'日本語の長文確認',lease_id:'lease-utf8'},devices:[]}):
    route==='connector/result'?{ok:true}:{job:null,devices:[]};
  response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(payload));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const config=path.join(dir,'connector.json');
  writeFileSync(config,JSON.stringify({hub:`http://127.0.0.1:${server.address().port}`,token:'test-token',agent:'rei'}));
  const child=spawn(process.execPath,['connector.mjs','--once'],{cwd:root,env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,REI_OPENCLAW_ENTRY:path.join(bin,'openclaw.mjs'),REI_CONNECTOR_CONFIG:config},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const timer=setTimeout(()=>child.kill(),15000);
  const code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
  assert.equal(code,0,output);
  assert.equal(received?.success,true,output);
  assert.equal(received.result,expected);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir,'pending-results.json'),'utf8')),[]);
  console.log('PASS split UTF-8 and long OpenClaw result reach Hub intact');
} finally {server.close();}
