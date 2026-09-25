import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, copyFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if(process.platform==='linux') {
  const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
  const units=mkdtempSync(path.join(os.tmpdir(),'rei-systemd-'));
  for(const mode of ['hub','connector']) {
    const result=spawnSync(process.execPath,['install-linux.mjs',mode],{cwd:root,encoding:'utf8',env:{...process.env,REI_SYSTEMD_DIR:units,REI_NO_START:'1',REI_DATA_DIR:'/tmp/rei-restored-data',REI_PORT:'4188'}});
    assert.equal(result.status,0,result.stderr);
    const unit=readFileSync(path.join(units,`rei-${mode}.service`),'utf8');
    assert.match(unit,/Restart=always/);
    assert.match(unit,new RegExp(`ExecStart=.*${mode}\\.mjs`));
    assert.match(unit,/REI_DATA_DIR=\/tmp\/rei-restored-data/);
    assert.match(unit,/REI_PORT=4188/);
  }
  const project=mkdtempSync(path.join(os.tmpdir(),'rei-linux-join-'));
  const bin=path.join(project,'bin');mkdirSync(bin);
  for(const file of ['connector.mjs','openclaw-process.mjs','rei-agent.mjs','mcp-sync.mjs','install-linux.mjs'])copyFileSync(path.join(root,file),path.join(project,file));
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
  writeFileSync(path.join(bin,'openclaw'),fakeOpenClaw);chmodSync(path.join(bin,'openclaw'),0o755);
  writeFileSync(path.join(bin,'systemctl'),'#!/bin/sh\nprintf "%s\\n" "$*" >> "$REI_SYSTEMCTL_LOG"\n');chmodSync(path.join(bin,'systemctl'),0o755);
  const server=createServer((request,response)=>{let input='';request.on('data',chunk=>input+=chunk);request.on('end',()=>{assert.equal(JSON.parse(input).code,'TESTCODE12345678');response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({token:'test-device-token'}));});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    writeFileSync(path.join(project,'openclaw.json'),'{}');
    const child=spawn(process.execPath,['connector.mjs','join',`http://127.0.0.1:${server.address().port}`],{cwd:project,env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,REI_CONNECTOR_CONFIG:path.join(project,'data','connector.json'),REI_SYSTEMD_DIR:path.join(project,'units'),REI_SYSTEMCTL_LOG:path.join(project,'systemctl.log'),REI_FAKE_AGENT_STATE:path.join(project,'agent.json'),REI_FAKE_CONFIG_FILE:path.join(project,'openclaw.json')},stdio:['pipe','pipe','pipe']});
    let output='',answered=false;child.stdout.on('data',chunk=>{output+=chunk;if(!answered&&output.includes('接続コード')){answered=true;child.stdin.end('TESTCODE12345678\n');}});child.stderr.on('data',chunk=>output+=chunk);
    const timer=setTimeout(()=>child.kill(),15000);
    const code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
    assert.equal(code,0,output);
    assert.equal(JSON.parse(readFileSync(path.join(project,'data','connector.json'),'utf8')).agent,'rei');
    assert.match(readFileSync(path.join(project,'units','rei-connector.service'),'utf8'),/connector\.mjs/);
    assert.match(readFileSync(path.join(project,'units','rei-connector.service'),'utf8'),/REI_CONNECTOR_CONFIG=/);
    assert.match(readFileSync(path.join(project,'systemctl.log'),'utf8'),/enable --now rei-connector\.service/);
  } finally {server.close();}
  console.log('PASS Linux user service registration and guided join');
} else console.log('SKIP Linux startup registration on this OS');
