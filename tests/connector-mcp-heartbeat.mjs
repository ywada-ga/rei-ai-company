import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=mkdtempSync(path.join(os.tmpdir(),'rei-mcp-heartbeat-'));
const bin=path.join(dir,'bin');mkdirSync(bin);
const fake=path.join(bin,'openclaw.mjs');
writeFileSync(fake,`const action=process.argv[3];
if(action==='status')setTimeout(()=>console.log(JSON.stringify({servers:[{name:'rei_abcdef123456',ok:true}]})),11500);
else if(action==='list')console.log('{}');
else if(action==='set')console.log('{}');
else process.exit(2);
`);
let heartbeats=0,claims=0;
const server=createServer((request,response)=>{
  const route=new URL(request.url,'http://localhost').searchParams.get('route');
  let result={error:'unknown route'};
  if(route==='connector/heartbeat'){
    heartbeats++;
    result={integrations:[{name:'rei_abcdef123456',label:'Knowledge',url:'https://example.com/mcp',auth:'none'}],checks:[]};
  } else if(route==='connector/claim'){claims++;result={job:null,devices:[]};}
  request.resume();response.writeHead(result.error?404:200,{'content-type':'application/json'});response.end(JSON.stringify(result));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const config=path.join(dir,'connector.json');
  writeFileSync(config,JSON.stringify({hub:`http://127.0.0.1:${server.address().port}`,token:'test-token',agent:'rei'}));
  const child=spawn(process.execPath,['connector.mjs','--once'],{cwd:root,env:{...process.env,REI_OPENCLAW_ENTRY:fake,REI_CONNECTOR_CONFIG:config},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const timer=setTimeout(()=>child.kill(),25000);
  const code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
  assert.equal(code,0,output);
  assert.ok(heartbeats>=2,`MCP確認中の心拍が不足しています: ${heartbeats}`);
  assert.equal(claims,1);
  assert.equal(JSON.parse(readFileSync(path.join(dir,'mcp-sync.json'),'utf8')).rei_abcdef123456.auth,'none');
  console.log('PASS connector stays online during a slow MCP status check');
} finally {server.close();}
