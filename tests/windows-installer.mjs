import { mkdtempSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if(process.platform==='win32') {
  const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
  const startup=mkdtempSync(path.join(os.tmpdir(),'rei-startup-'));
  for(const mode of ['hub','connector']) {
    const result=spawnSync(process.execPath,['install-windows.mjs',mode],{cwd:root,env:{...process.env,REI_STARTUP_DIR:startup,REI_NO_START:'1',REI_DATA_DIR:'C:\\rei-restored-data',REI_BACKUP_DIR:'D:\\rei-backups',REI_PORT:'4188',REI_JOB_TIMEOUT_SECONDS:'3600'},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const name=mode==='hub'?'REI Hub.cmd':'REI Connector.cmd';
    const script=readFileSync(path.join(startup,name),'utf8');
    assert.match(script,/setlocal DisableDelayedExpansion/);
    assert.match(script,/start "" \/min/);
    assert.match(script,new RegExp(`${mode==='hub'?'hub':'connector'}\\.mjs`));
    assert.match(script,/REI_DATA_DIR=C:\\rei-restored-data/);
    assert.match(script,/REI_BACKUP_DIR=D:\\rei-backups/);
    assert.match(script,/REI_PORT=4188/);
    assert.match(script,/REI_JOB_TIMEOUT_SECONDS=3600/);
  }
  const invalidStartup=path.join(startup,'invalid-timeout');
  const badTimeout=spawnSync(process.execPath,['install-windows.mjs','connector'],{cwd:root,env:{...process.env,REI_STARTUP_DIR:invalidStartup,REI_JOB_TIMEOUT_SECONDS:'0'},encoding:'utf8'});
  assert.notEqual(badTimeout.status,0);
  assert.equal(existsSync(invalidStartup),false);
  const hubScript=path.join(startup,'REI Hub.cmd');
  const original=readFileSync(hubScript,'utf8');
  const invalidUpdate=spawnSync(process.execPath,['install-windows.mjs','connector'],{cwd:root,env:{...process.env,REI_STARTUP_DIR:startup,REI_JOB_TIMEOUT_SECONDS:'0'},encoding:'utf8'});
  assert.notEqual(invalidUpdate.status,0);
  assert.equal(readFileSync(path.join(startup,'REI Connector.cmd'),'utf8').includes('REI_JOB_TIMEOUT_SECONDS=3600'),true);
  const updated=spawnSync(process.execPath,['install-windows.mjs','hub'],{cwd:root,env:{...process.env,REI_STARTUP_DIR:startup,REI_NO_START:'1',REI_PORT:'4199'},encoding:'utf8'});
  assert.equal(updated.status,0,updated.stderr);
  assert.match(readFileSync(hubScript,'utf8'),/REI_PORT=4199/);
  assert.notEqual(readFileSync(hubScript,'utf8'),original);
  assert.ok(!readdirSync(startup).some(name=>name.endsWith('.tmp')));
  const blocked=path.join(startup,'blocked');mkdirSync(path.join(blocked,'REI Hub.cmd'),{recursive:true});
  const failedWrite=spawnSync(process.execPath,['install-windows.mjs','hub'],{cwd:root,env:{...process.env,REI_STARTUP_DIR:blocked,REI_NO_START:'1'},encoding:'utf8'});
  assert.notEqual(failedWrite.status,0);
  assert.ok(!readdirSync(blocked).some(name=>name.endsWith('.tmp')));
  console.log('PASS Windows startup registration');
} else console.log('SKIP Windows startup registration on this OS');
