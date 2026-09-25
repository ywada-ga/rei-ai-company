import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=mkdtempSync(path.join(os.tmpdir(),'rei-doctor-'));
const bin=path.join(dir,'bin');mkdirSync(bin);
const fake='#!/usr/bin/env node\nif(process.argv.includes("--version"))console.log("1.0");else if(process.argv.includes("list"))console.log(JSON.stringify([{id:"rei"}]));else process.exit(2);\n';
for(const name of ['openclaw','openclaw.mjs']){const file=path.join(bin,name);writeFileSync(file,fake);chmodSync(file,0o755);}
const server=createServer((req,res)=>{const status=new URL(req.url,'http://localhost').searchParams.get('route')==='connector/status';const ok=!status||req.headers.authorization==='Bearer secret-do-not-print';res.writeHead(ok?200:401,{'content-type':'application/json'});res.end(JSON.stringify({ok}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const config=path.join(dir,'connector.json');
const env={...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,REI_OPENCLAW_ENTRY:path.join(bin,'openclaw.mjs'),REI_CONNECTOR_CONFIG:config};
async function doctor() {
  const child=spawn(process.execPath,['doctor.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const code=await new Promise(resolve=>child.on('close',resolve));
  return {code,output};
}
try {
  writeFileSync(config,JSON.stringify({hub:`http://127.0.0.1:${server.address().port}`,token:'secret-do-not-print',agent:'rei'}));
  const healthy=await doctor();
  assert.equal(healthy.code,0,healthy.output);
  assert.match(healthy.output,/中心PCのREIに接続できます/);
  assert.match(healthy.output,/端末トークンは中心PCで有効です/);
  assert.doesNotMatch(healthy.output,/secret-do-not-print/);
  writeFileSync(config,JSON.stringify({hub:`http://127.0.0.1:${server.address().port}`,token:'revoked-token',agent:'rei'}));
  const revoked=await doctor();
  assert.equal(revoked.code,1);
  assert.match(revoked.output,/要確認  端末トークンが無効です/);
  assert.doesNotMatch(revoked.output,/revoked-token/);
  writeFileSync(config,JSON.stringify({hub:`http://127.0.0.1:${server.address().port}`,token:'secret-do-not-print',agent:'rei'}));
  writeFileSync(path.join(dir,'pending-results.json.tmp'),'unfinished');
  const interrupted=await doctor();
  assert.equal(interrupted.code,1);
  assert.match(interrupted.output,/保存途中ファイル/);
  unlinkSync(path.join(dir,'pending-results.json.tmp'));
  unlinkSync(config);
  const missing=await doctor();
  assert.equal(missing.code,1);
  assert.match(missing.output,/接続設定がありません/);
  console.log('PASS connector doctor checks prerequisites without showing tokens');
} finally {server.close();}
