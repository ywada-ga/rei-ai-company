import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStorage, SCHEMA_VERSION } from '../storage.mjs';

const dir=mkdtempSync(path.join(os.tmpdir(),'rei-schema-version-'));
process.env.REI_DATA_DIR=dir;
let db=openStorage(dir);
assert.equal(db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);
db.exec("INSERT INTO settings(key,value) VALUES('sentinel','preserved')");
db.exec('PRAGMA user_version=0');
db.close();

db=openStorage(dir);
assert.equal(db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);
assert.equal(db.prepare("SELECT value FROM settings WHERE key='sentinel'").get().value,'preserved');
db.exec(`PRAGMA user_version=${SCHEMA_VERSION+1}`);
db.close();

assert.throws(()=>openStorage(dir),/新しいREI用/);
db=new DatabaseSync(path.join(dir,'rei.sqlite'),{readOnly:true});
assert.equal(db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION+1);
assert.equal(db.prepare("SELECT value FROM settings WHERE key='sentinel'").get().value,'preserved');
db.close();
console.log('PASS newer database schemas are rejected without changing saved data');
