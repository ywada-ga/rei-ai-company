import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { checkOpenClaw, spawnOpenClaw } from '../openclaw-process.mjs';

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
  console.log('PASS Windows OpenClaw invocation');
} else console.log('SKIP Windows OpenClaw invocation on this OS');
