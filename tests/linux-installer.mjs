import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if(process.platform==='linux') {
  const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
  const units=mkdtempSync(path.join(os.tmpdir(),'rei-systemd-'));
  for(const mode of ['hub','connector']) {
    const result=spawnSync(process.execPath,['install-linux.mjs',mode],{cwd:root,encoding:'utf8',env:{...process.env,REI_SYSTEMD_DIR:units,REI_NO_START:'1'}});
    assert.equal(result.status,0,result.stderr);
    const unit=readFileSync(path.join(units,`rei-${mode}.service`),'utf8');
    assert.match(unit,/Restart=always/);
    assert.match(unit,new RegExp(`ExecStart=.*${mode}\\.mjs`));
  }
  console.log('PASS Linux user service registration');
} else console.log('SKIP Linux startup registration on this OS');
