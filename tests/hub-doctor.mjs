import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStorage, one, run } from '../storage.mjs';
import { createBackup } from '../backup.mjs';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=mkdtempSync(path.join(os.tmpdir(),'rei-hub-doctor-'));
process.env.REI_DATA_DIR=data;
const db=openStorage(data);
const server=createServer((request,response)=>{
  response.writeHead(200,{'content-type':'application/json'});
  response.end(JSON.stringify({needsSetup:!one(db,"SELECT id FROM users WHERE role='owner' LIMIT 1")}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
async function diagnose() {
  const child=spawn(process.execPath,['doctor-hub.mjs'],{cwd:root,env:{...process.env,REI_DATA_DIR:data,REI_PORT:String(server.address().port)},stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',chunk=>output+=chunk);
  child.stderr.on('data',chunk=>output+=chunk);
  const code=await new Promise(resolve=>child.on('close',resolve));
  return {code,output};
}
try {
  const initial=await diagnose();
  assert.equal(initial.code,1);
  assert.match(initial.output,/所有者の初回登録を完了してください/);
  run(db,"INSERT INTO users(id,username,salt,digest,role) VALUES(?,?,?,?,?)",'owner','owner','salt','digest','owner');
  const unprotected=await diagnose();
  assert.equal(unprotected.code,1);
  assert.match(unprotected.output,/有効なバックアップを確認できません/);
  const backup=await createBackup(data);
  const healthy=await diagnose();
  assert.equal(healthy.code,0,healthy.output);
  assert.match(healthy.output,/最新のバックアップを検証しました/);
  writeFileSync(path.join(backup,'manifest.json'),'broken');
  const damaged=await diagnose();
  assert.equal(damaged.code,1);
  assert.match(damaged.output,/有効なバックアップを確認できません/);
  console.log('PASS Hub doctor checks setup and backup without changing data');
} finally {db.close();server.close();}
