import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=createServer((request,response)=>{
  assert.equal(new URL(request.url,'http://localhost').searchParams.get('route'),'setup/status');
  response.writeHead(200,{'content-type':'application/json'});
  response.end(JSON.stringify({needsSetup:false}));
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
  console.log('PASS launcher opens an existing REI without starting a second Hub');
} finally {server.close();}
