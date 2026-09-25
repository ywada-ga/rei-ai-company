import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
let runningVersion=version;
let responseStatus=200;
const server=createServer((request,response)=>{
  assert.equal(new URL(request.url,'http://localhost').searchParams.get('route'),'setup/status');
  response.writeHead(responseStatus,{'content-type':'application/json'});
  response.end(JSON.stringify({needsSetup:false,version:runningVersion}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const port=server.address().port;
  async function verify(command,args,label) {
    const child=spawn(command,args,{cwd:root,env:{...process.env,REI_PORT:String(port),REI_NO_BROWSER:'1'},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
    const code=await new Promise(resolve=>child.on('close',resolve));
    assert.equal(code,0,`${label}: ${output}`);
    assert.match(output,/起動中のREIを開きます/);
    assert.match(output,new RegExp(`http://127\\.0\\.0\\.1:${port}/`));
  }
  await verify(process.execPath,['launch.mjs'],'Node launcher');
  if(process.platform==='darwin')await verify('zsh',['Start-REI.command'],'Mac launcher');
  if(process.platform==='win32')await verify('cmd.exe',['/d','/c','Start-REI.cmd'],'Windows launcher');
  runningVersion='0.0.0';
  const child=spawn(process.execPath,['launch.mjs'],{cwd:root,env:{...process.env,REI_PORT:String(port),REI_NO_BROWSER:'1'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const code=await new Promise(resolve=>child.on('close',resolve));
  assert.equal(code,1);
  assert.match(output,/起動中のREIは版 0\.0\.0/);
  assert.doesNotMatch(output,/起動中のREIを開きます/);
  responseStatus=404;
  const occupied=spawn(process.execPath,['launch.mjs'],{cwd:root,env:{...process.env,REI_PORT:String(port),REI_NO_BROWSER:'1'},stdio:['ignore','pipe','pipe']});
  let occupiedOutput='';occupied.stdout.setEncoding('utf8');occupied.stderr.setEncoding('utf8');occupied.stdout.on('data',chunk=>occupiedOutput+=chunk);occupied.stderr.on('data',chunk=>occupiedOutput+=chunk);
  assert.equal(await new Promise(resolve=>occupied.on('close',resolve)),1);
  assert.match(occupiedOutput,/別のサービスが使用中/);
  assert.doesNotMatch(occupiedOutput,/REI Hub:/);
  console.log('PASS launcher distinguishes the current Hub, an older Hub, and an occupied port');
} finally {server.close();}
