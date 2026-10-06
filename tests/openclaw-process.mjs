import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { checkOpenClaw, runOpenClawCli, spawnOpenClaw, parseOpenClawResult, jobTimeoutSeconds } from '../openclaw-process.mjs';

assert.equal(jobTimeoutSeconds(undefined),1800);
assert.equal(jobTimeoutSeconds('3600'),3600);
assert.throws(()=>jobTimeoutSeconds('0'),/60〜7200/);
assert.throws(()=>jobTimeoutSeconds('7201'),/60〜7200/);

assert.equal(parseOpenClawResult(JSON.stringify({status:'ok',result:{payloads:[{text:'確認済み'}],meta:{aborted:false}}})),'確認済み');
assert.throws(()=>parseOpenClawResult(JSON.stringify({status:'error',result:{payloads:[{text:'できました'}]}})),/処理状態/);
assert.throws(()=>parseOpenClawResult(JSON.stringify({status:'ok',result:{payloads:[],meta:{aborted:true}}})),/中断/);
assert.throws(()=>parseOpenClawResult('not json'),/JSON形式/);
assert.throws(()=>parseOpenClawResult(JSON.stringify({status:'ok',result:{payloads:[{text:'⚠️ 🛠️ Bash failed: example'}]}})),/操作結果/);

const bundledDir=mkdtempSync(path.join(os.tmpdir(),'rei-bundled-openclaw-'));
const bundledEntry=path.join(bundledDir,'openclaw.mjs');
writeFileSync(bundledEntry,'process.stdout.write(process.argv.includes("--version")?"Bundled OpenClaw":JSON.stringify({args:process.argv.slice(2)}));');
process.env.REI_OPENCLAW_ENTRY=bundledEntry;
assert.match(checkOpenClaw().stdout,/Bundled OpenClaw/);
assert.deepEqual(JSON.parse(runOpenClawCli(['status']).stdout).args,['status']);
const bundledChild=spawnOpenClaw('rei','bundled-session','同梱版から実行');
let bundledOutput='';bundledChild.stdout.on('data',chunk=>bundledOutput+=chunk);
assert.equal(await new Promise(resolve=>bundledChild.on('close',resolve)),0);
assert.ok(JSON.parse(bundledOutput).args.includes('--json'));
const voiceChild=spawnOpenClaw('rei','voice-session','音声の質問',1800,{thinking:'low',local:true});
let voiceOutput='';voiceChild.stdout.on('data',chunk=>voiceOutput+=chunk);
assert.equal(await new Promise(resolve=>voiceChild.once('close',resolve)),0);
const voiceArgs=JSON.parse(voiceOutput).args;
assert.equal(voiceArgs[voiceArgs.indexOf('--thinking')+1],'low');assert.ok(voiceArgs.includes('--local'));
assert.equal(parseOpenClawResult(JSON.stringify({payloads:[{text:'直接の回答'}],meta:{aborted:false}})),'直接の回答');
assert.throws(()=>parseOpenClawResult(JSON.stringify({payloads:[{text:'不完全な回答'}],meta:{aborted:true}})),/中断/);
delete process.env.REI_OPENCLAW_ENTRY;
console.log('PASS Bundled OpenClaw invocation');

if(process.platform==='win32') {
  const dir=mkdtempSync(path.join(os.tmpdir(),'rei-windows-runner-'));
  const packageDir=path.join(dir,'node_modules','openclaw');
  mkdirSync(packageDir,{recursive:true});
  writeFileSync(path.join(dir,'openclaw.cmd'),'@echo off\r\n');
  writeFileSync(path.join(packageDir,'openclaw.mjs'),'process.stdout.write(JSON.stringify({args:process.argv.slice(2)}));');
  process.env.PATH=`${dir}${path.delimiter}${process.env.PATH}`;
  assert.equal(checkOpenClaw().status,0);
  const instruction='日本語 "引用" & | < > % ! と改行\n次の行';
  const child=spawnOpenClaw('main','rei-test-session',instruction);
  let out='',err='';
  child.stdout.on('data',chunk=>out+=chunk);
  child.stderr.on('data',chunk=>err+=chunk);
  const code=await new Promise(resolve=>child.on('close',resolve));
  assert.equal(code,0,err);
  const args=JSON.parse(out).args;
  assert.equal(args[args.indexOf('--message')+1],instruction);
  assert.equal(args[args.indexOf('--timeout')+1],'1800');
  console.log('PASS Windows OpenClaw invocation');
} else {
  const dir=mkdtempSync(path.join(os.tmpdir(),'rei-unix-runner-'));
  const entry=path.join(dir,'openclaw');
  writeFileSync(entry,'#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2)}));\n');
  chmodSync(entry,0o755);
  process.env.PATH=`${dir}${path.delimiter}${process.env.PATH}`;
  const child=spawnOpenClaw('rei','rei-test-session','長い仕事',3600);
  let out='';child.stdout.on('data',chunk=>out+=chunk);
  const code=await new Promise(resolve=>child.on('close',resolve));
  assert.equal(code,0);
  const args=JSON.parse(out).args;
  assert.equal(args[args.indexOf('--timeout')+1],'3600');
  console.log('PASS Unix OpenClaw invocation and configurable deadline');
}
