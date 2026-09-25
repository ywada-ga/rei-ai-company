import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=path.join(mkdtempSync(path.join(os.tmpdir(),'rei-connector-guard-')),'connector.json');
const original='{"hub":"http://127.0.0.1:4178","token":"existing-token","agent":"main"}';
writeFileSync(config,original);
const result=spawnSync(process.execPath,['connector.mjs','join','http://127.0.0.1:4178'],{cwd:root,env:{...process.env,REI_CONNECTOR_CONFIG:config},encoding:'utf8',timeout:10000});
assert.notEqual(result.status,0);
assert.match(result.stderr,/既にREIの接続設定/);
assert.equal(readFileSync(config,'utf8'),original);
console.log('PASS existing connector configuration is preserved');
