import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if(process.platform==='darwin') {
  const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
  const temp=mkdtempSync(path.join(os.tmpdir(),'rei-launch-agent-'));
  const bin=path.join(temp,'bin'),agents=path.join(temp,'agents'),data=path.join(temp,'restored-data');
  mkdirSync(bin);
  const fake=path.join(bin,'launchctl');
  writeFileSync(fake,'#!/bin/sh\nif [ "$1" = bootstrap ] && [ -n "$REI_TEST_FAIL_PORT" ] && /usr/bin/grep -Fq "$REI_TEST_FAIL_PORT" "$3"; then exit 1; fi\nexit 0\n');chmodSync(fake,0o755);
  for(const mode of ['hub','connector']) {
    const result=spawnSync(process.execPath,['install-macos.mjs',mode],{cwd:root,encoding:'utf8',env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,REI_LAUNCH_AGENTS_DIR:agents,REI_DATA_DIR:data,REI_CONNECTOR_CONFIG:path.join(data,'connector.json'),REI_PORT:'4188',REI_JOB_TIMEOUT_SECONDS:'3600'}});
    assert.equal(result.status,0,result.stderr);
    const plist=readFileSync(path.join(agents,`ai.rei.${mode}.plist`),'utf8');
    assert.match(plist,new RegExp(`<string>${mode}\\.mjs</string>`));
    assert.match(plist,/<key>REI_DATA_DIR<\/key><string>.*restored-data<\/string>/);
    assert.match(plist,/<key>REI_CONNECTOR_CONFIG<\/key><string>.*connector\.json<\/string>/);
    assert.match(plist,/<key>REI_PORT<\/key><string>4188<\/string>/);
    assert.match(plist,/<key>REI_JOB_TIMEOUT_SECONDS<\/key><string>3600<\/string>/);
    assert.equal(statSync(path.join(agents,`ai.rei.${mode}.plist`)).mode&0o777,0o600);
  }
  const failedUpdate=spawnSync(process.execPath,['install-macos.mjs','hub'],{cwd:root,encoding:'utf8',env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,REI_LAUNCH_AGENTS_DIR:agents,REI_DATA_DIR:data,REI_PORT:'4199',REI_TEST_FAIL_PORT:'<string>4199</string>'}});
  assert.notEqual(failedUpdate.status,0);
  assert.match(readFileSync(path.join(agents,'ai.rei.hub.plist'),'utf8'),/<key>REI_PORT<\/key><string>4188<\/string>/);
  const emptyAgents=path.join(temp,'failed-new-agents');
  const failedNew=spawnSync(process.execPath,['install-macos.mjs','hub'],{cwd:root,encoding:'utf8',env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,REI_LAUNCH_AGENTS_DIR:emptyAgents,REI_DATA_DIR:data,REI_PORT:'4199',REI_TEST_FAIL_PORT:'<string>4199</string>'}});
  assert.notEqual(failedNew.status,0);
  assert.equal(existsSync(path.join(emptyAgents,'ai.rei.hub.plist')),false);
  const project=path.join(temp,'joined-pc');mkdirSync(project);
  for(const file of ['package.json','connector.mjs','openclaw-process.mjs','rei-agent.mjs','mcp-sync.mjs','install-macos.mjs'])copyFileSync(path.join(root,file),path.join(project,file));
  const fakeOpenClaw=`#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2),key=args.slice(0,2).join(' ');
const state=fs.existsSync(process.env.REI_FAKE_AGENT_STATE)?JSON.parse(fs.readFileSync(process.env.REI_FAKE_AGENT_STATE,'utf8')):null;
if(args[0]==='--version')console.log('test');
else if(key==='agents list')console.log(JSON.stringify(state?[{id:'main',workspace:'/other'},state]:[{id:'main',workspace:'/other'}]));
else if(key==='config file')console.log(process.env.REI_FAKE_CONFIG_FILE);
else if(key==='agents add'){const agent={id:'rei',workspace:args[args.indexOf('--workspace')+1]};fs.writeFileSync(process.env.REI_FAKE_AGENT_STATE,JSON.stringify(agent));console.log(JSON.stringify(agent));}
else if(key==='config get')console.log(JSON.stringify({list:[{id:'main'},state?{id:'rei',tools:{deny:[]}}:null].filter(Boolean)}));
else if(['agents set-identity','config set','config validate'].includes(key))console.log('ok');
else process.exit(2);
`;
  const openclaw=path.join(bin,'openclaw');writeFileSync(openclaw,fakeOpenClaw);chmodSync(openclaw,0o755);
  const server=createServer((request,response)=>{let input='';request.on('data',chunk=>input+=chunk);request.on('end',()=>{const code=JSON.parse(input).code;if(code!=='TESTCODE12345678'){response.writeHead(403,{'content-type':'application/json'});response.end(JSON.stringify({error:'接続コードが無効です'}));return;}response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({token:'test-device-token'}));});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const configFile=path.join(temp,'openclaw.json');writeFileSync(configFile,'{}');
    const invalid=spawn(process.execPath,['connector.mjs','join',`http://127.0.0.1:${server.address().port}`],{cwd:project,env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,REI_LAUNCH_AGENTS_DIR:path.join(temp,'joined-agents'),REI_FAKE_AGENT_STATE:path.join(temp,'agent.json'),REI_FAKE_CONFIG_FILE:configFile},stdio:['pipe','pipe','pipe']});
    let invalidOutput='',invalidAnswered=false;invalid.stdout.on('data',chunk=>{invalidOutput+=chunk;if(!invalidAnswered&&invalidOutput.includes('接続コード')){invalidAnswered=true;invalid.stdin.end('INVALIDCODE12345\n');}});invalid.stderr.on('data',chunk=>invalidOutput+=chunk);
    const invalidTimer=setTimeout(()=>invalid.kill(),15000);
    const invalidCode=await new Promise(resolve=>invalid.on('close',resolve));clearTimeout(invalidTimer);
    assert.notEqual(invalidCode,0);
    assert.equal(existsSync(path.join(temp,'agent.json')),false);
    const child=spawn(process.execPath,['connector.mjs','join',`http://127.0.0.1:${server.address().port}`],{cwd:project,env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,REI_LAUNCH_AGENTS_DIR:path.join(temp,'joined-agents'),REI_FAKE_AGENT_STATE:path.join(temp,'agent.json'),REI_FAKE_CONFIG_FILE:configFile},stdio:['pipe','pipe','pipe']});
    let output='',answered=false;child.stdout.on('data',chunk=>{output+=chunk;if(!answered&&output.includes('接続コード')){answered=true;child.stdin.end('TESTCODE12345678\n');}});child.stderr.on('data',chunk=>output+=chunk);
    const timer=setTimeout(()=>child.kill(),15000);
    const code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
    assert.equal(code,0,output);
    assert.equal(JSON.parse(readFileSync(path.join(project,'data','connector.json'),'utf8')).agent,'rei');
    assert.match(readFileSync(path.join(temp,'joined-agents','ai.rei.connector.plist'),'utf8'),/connector\.mjs/);
  } finally {server.close();}
  console.log('PASS macOS LaunchAgent registration and guided join');
} else console.log('SKIP macOS LaunchAgent registration on this OS');
