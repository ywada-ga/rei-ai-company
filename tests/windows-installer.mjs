import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if(process.platform==='win32') {
  const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
  const startup=mkdtempSync(path.join(os.tmpdir(),'rei-startup-'));
  for(const mode of ['hub','connector']) {
    const result=spawnSync(process.execPath,['install-windows.mjs',mode],{cwd:root,env:{...process.env,REI_STARTUP_DIR:startup,REI_NO_START:'1',REI_DATA_DIR:'C:\\rei-restored-data',REI_PORT:'4188',REI_JOB_TIMEOUT_SECONDS:'3600'},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const name=mode==='hub'?'REI Hub.cmd':'REI Connector.cmd';
    const script=readFileSync(path.join(startup,name),'utf8');
    assert.match(script,/start "" \/min/);
    assert.match(script,new RegExp(`${mode==='hub'?'hub':'connector'}\\.mjs`));
    assert.match(script,/REI_DATA_DIR=C:\\rei-restored-data/);
    assert.match(script,/REI_PORT=4188/);
    assert.match(script,/REI_JOB_TIMEOUT_SECONDS=3600/);
  }
  const invalidStartup=path.join(startup,'invalid-timeout');
  const badTimeout=spawnSync(process.execPath,['install-windows.mjs','connector'],{cwd:root,env:{...process.env,REI_STARTUP_DIR:invalidStartup,REI_JOB_TIMEOUT_SECONDS:'0'},encoding:'utf8'});
  assert.notEqual(badTimeout.status,0);
  assert.equal(existsSync(invalidStartup),false);
  console.log('PASS Windows startup registration');
} else console.log('SKIP Windows startup registration on this OS');
