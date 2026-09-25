import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { syncMcp } from '../mcp-sync.mjs';

const dir=mkdtempSync(path.join(os.tmpdir(),'rei-mcp-'));
const configPath=path.join(dir,'connector.json');
const entries={};
let tokens=false;
const command=args=>{
  const [,action,name,definition]=args;
  if(action==='list')return {status:0,stdout:JSON.stringify(entries)};
  if(action==='status')return {status:0,stdout:JSON.stringify({servers:Object.keys(entries).map(key=>({name:key,ok:true,authStatus:{hasTokens:tokens}}))})};
  if(action==='set'){entries[name]=JSON.parse(definition);return {status:0,stdout:'{}'};}
  if(action==='unset'){delete entries[name];return {status:0,stdout:'{}'};}
  throw new Error(`Unexpected MCP command: ${args.join(' ')}`);
};
const integration={name:'rei_abcdef123456',label:'Calendar',url:'https://example.com/mcp',auth:'oauth'};
assert.equal(syncMcp(configPath,[integration],command)[0].status,'auth_required');
assert.equal(entries[integration.name].url,integration.url);
assert.equal(JSON.parse(readFileSync(path.join(dir,'mcp-sync.json')))[integration.name].auth,'oauth');
tokens=true;
assert.equal(syncMcp(configPath,[integration],command)[0].status,'configured');
syncMcp(configPath,[],command);
assert.equal(Object.keys(entries).length,0);
assert.throws(()=>syncMcp(configPath,[{...integration,url:'http://127.0.0.1/mcp'}],command));
entries[integration.name]={url:'https://another.example/mcp'};
assert.throws(()=>syncMcp(configPath,[integration],command),/重複/);
console.log('PASS MCP sync, status, removal, validation, collision');
