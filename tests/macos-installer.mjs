import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
  writeFileSync(fake,'#!/bin/sh\nexit 0\n');chmodSync(fake,0o755);
  for(const mode of ['hub','connector']) {
    const result=spawnSync(process.execPath,['install-macos.mjs',mode],{cwd:root,encoding:'utf8',env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,REI_LAUNCH_AGENTS_DIR:agents,REI_DATA_DIR:data,REI_CONNECTOR_CONFIG:path.join(data,'connector.json'),REI_PORT:'4188'}});
    assert.equal(result.status,0,result.stderr);
    const plist=readFileSync(path.join(agents,`ai.rei.${mode}.plist`),'utf8');
    assert.match(plist,new RegExp(`<string>${mode}\\.mjs</string>`));
    assert.match(plist,/<key>REI_DATA_DIR<\/key><string>.*restored-data<\/string>/);
    assert.match(plist,/<key>REI_CONNECTOR_CONFIG<\/key><string>.*connector\.json<\/string>/);
    assert.match(plist,/<key>REI_PORT<\/key><string>4188<\/string>/);
    assert.equal(statSync(path.join(agents,`ai.rei.${mode}.plist`)).mode&0o777,0o600);
  }
  console.log('PASS macOS LaunchAgent registration preserves restored settings');
} else console.log('SKIP macOS LaunchAgent registration on this OS');
