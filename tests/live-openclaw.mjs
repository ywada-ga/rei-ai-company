import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=mkdtempSync(path.join(os.tmpdir(),'rei-openclaw-'));
const hub=spawn(process.execPath,['hub.mjs'],{cwd:root,env:{...process.env,REI_DATA_DIR:data,REI_PORT:'4182'},stdio:['ignore','pipe','pipe']});
let output='';hub.stdout.on('data',x=>output+=x);hub.stderr.on('data',x=>output+=x);
let connector;
try {
  for(let i=0;i<100&&!output.includes('REI Hub:');i++)await new Promise(r=>setTimeout(r,100));
  assert.match(output,/REI Hub:/);
  const setup=output.match(/\?setup=([^\s]+)/)[1];let cookie='';
  const api=async(route,data)=>{const res=await fetch(`http://127.0.0.1:4182/api?route=${route}`,{method:data?'POST':'GET',headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:data?JSON.stringify(data):undefined});const body=await res.json();assert.ok(res.ok,`${route}: ${JSON.stringify(body)}`);if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return body;};
  await api('setup/complete',{token:setup,username:'owner',password:'smoke-test-password-123'});
  await api('auth/login',{username:'owner',password:'smoke-test-password-123'});
  const enrolled=await api('devices/enroll',{label:'test-openclaw',isPlanner:true});
  const configPath=path.join(data,'connector.json');
  writeFileSync(configPath,JSON.stringify({hub:'http://127.0.0.1:4182',token:enrolled.token,agent:process.env.REI_TEST_AGENT||'main'}),{mode:0o600});
  connector=spawn(process.execPath,['connector.mjs'],{cwd:root,env:{...process.env,REI_CONNECTOR_CONFIG:configPath},stdio:['ignore','pipe','pipe']});
  connector.stdout.on('data',x=>process.stdout.write(x));connector.stderr.on('data',x=>process.stderr.write(x));
  const task=await api('command',{text:'REIの接続確認です。外部操作は不要です。最後に「接続成功」と短く返してください。',department:'operations'});
  let state;
  for(let i=0;i<120;i++) {await new Promise(r=>setTimeout(r,2000));state=(await api('bootstrap')).tasks.find(t=>t.id===task.task.id);if(['completed','needs_review','failed'].includes(state.status))break;}
  assert.equal(state.status,'completed',`status=${state.status}, error=${state.error}`);
  assert.match(state.result,/接続成功/);
  console.log('PASS real OpenClaw dispatch:',state.status);
} finally {connector?.kill('SIGTERM');hub.kill('SIGTERM');}
