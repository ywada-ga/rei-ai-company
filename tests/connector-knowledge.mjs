import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const dir=mkdtempSync(path.join(os.tmpdir(),'rei-knowledge-connector-'));
const entry=path.join(dir,'openclaw.mjs');
writeFileSync(entry,`const args=process.argv.slice(2);if(args[0]==='mcp')console.log(args[1]==='list'?'{}':'{"servers":[]}');else if(args[0]==='agent')console.log(JSON.stringify({payloads:[{text:JSON.stringify({args})}]}));else process.exit(1);`);
let job,received,claimed=false;
const server=createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const route=new URL(req.url,'http://localhost').searchParams.get('route');
 if(route==='connector/result')received=JSON.parse(Buffer.concat(chunks));
 const value=route==='connector/heartbeat'?{integrations:[],checks:[]}:route==='connector/claim'&&!claimed?(claimed=true,{job,devices:[]}):route==='connector/result'?{ok:true}:{job:null,devices:[]};
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
 const config=path.join(dir,'connector.json');
 writeFileSync(config,JSON.stringify({hub:`http://127.0.0.1:${server.address().port}`,token:'fixture-token',agent:'main'}));
 for(const mode of ['catalog','answer','voice','scan']){
  claimed=false;received=null;job={id:`query-${mode}`,lease_id:'fixture-lease',kind:'execute',text:'確認する',knowledge_mode:mode==='voice'?'answer':mode,knowledge_voice:mode==='voice'?1:0,knowledge_scope:JSON.stringify(mode==='catalog'?[]:[{id:'shared',name:'共有'}]),knowledge_context:'[]'};
  const p=spawn(process.execPath,['connector.mjs','--once'],{cwd:root,env:{...process.env,REI_OPENCLAW_ENTRY:entry,REI_CONNECTOR_CONFIG:config},stdio:['ignore','pipe','pipe']});
  let output='';p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>output+=x);
  const timer=setTimeout(()=>p.kill(),15000);const code=await new Promise(resolve=>p.once('close',resolve));clearTimeout(timer);
  assert.equal(code,0,output);assert.equal(received.success,true,output);
  const args=JSON.parse(received.result).args;
  assert.ok(args.includes('--local'));
  assert.equal(args[args.indexOf('--timeout')+1],mode==='catalog'?'90':mode==='voice'?'150':'240');
  assert.equal(args[args.indexOf('--thinking')+1],'low');
  const prompt=args[args.indexOf('--message')+1];assert.match(prompt,/今回の工程は検索・回答・提案だけ/);
  if(mode!=='catalog')assert.match(prompt,/"id":"shared"/);
  assert.match(output,/timeoutSeconds/);assert.match(output,/durationMs/);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir,'pending-results.json'))),[]);
 }
 console.log('PASS full Connector knowledge dispatch: text, voice, catalog, scan, deadlines, local backend and result acknowledgement');
} finally {await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
