import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureReiAgent, reuseMainAgent } from '../rei-agent.mjs';

const root=mkdtempSync(path.join(os.tmpdir(),'rei-agent-'));
const configFile=path.join(root,'openclaw.json');
writeFileSync(configFile,'{"test":true}');
const workspace=path.join(root,'data','openclaw-workspace');
let agent=null,deny=[],adds=0,identityUpdates=0;
const command=args=>{
  const key=args.slice(0,2).join(' ');
  let stdout='';
  if(key==='agents list')stdout=JSON.stringify(agent?[agent]:[{id:'main',workspace:'/other'}]);
  else if(key==='config file')stdout=configFile;
  else if(key==='agents add'){adds++;agent={id:'rei',workspace};stdout=JSON.stringify(agent);}
  else if(key==='agents set-identity'){identityUpdates++;stdout='{}';}
  else if(key==='config get')stdout=JSON.stringify({list:[{id:'main'},agent?{id:'rei',tools:{deny}}:null].filter(Boolean)});
  else if(key==='config set'){assert.equal(args[2],'agents.list[1].tools.deny');deny=JSON.parse(args[3]);stdout='ok';}
  else if(key==='config validate')stdout='valid';
  else throw new Error(`Unexpected ${args.join(' ')}`);
  return {status:0,stdout,stderr:''};
};
assert.equal(ensureReiAgent(root,command).agent,'rei');
assert.equal(adds,1);
assert.deepEqual(deny,['message','sessions_send','gateway']);
assert.match(readFileSync(path.join(workspace,'AGENTS.md'),'utf8'),/計画担当/);
assert.equal(existsSync(path.join(root,'data','private-backups','openclaw-before-rei.json')),true);
writeFileSync(path.join(workspace,'AGENTS.md'),'customized');
unlinkSync(path.join(workspace,'SOUL.md'));
assert.equal(ensureReiAgent(root,command).created,false);
assert.equal(adds,1);
assert.equal(identityUpdates,2);
assert.equal(readFileSync(path.join(workspace,'AGENTS.md'),'utf8'),'customized');
assert.equal(existsSync(path.join(workspace,'SOUL.md')),true);
agent={id:'rei',workspace:'/someone-else'};
assert.throws(()=>ensureReiAgent(root,command),/別の用途/);
const mainRoot=mkdtempSync(path.join(os.tmpdir(),'rei-main-'));
const mainConfig=path.join(mainRoot,'openclaw.json');
writeFileSync(mainConfig,'{"personal":true}');
let main={id:'main',workspace:'/old-personal-workspace'},mainDeny=[];
const mainCommand=args=>{
  const key=args.slice(0,2).join(' ');
  let stdout='';
  if(key==='agents list')stdout=JSON.stringify([main]);
  else if(key==='config file')stdout=mainConfig;
  else if(key==='config get')stdout=JSON.stringify({list:[{...main,tools:{deny:mainDeny}}]});
  else if(key==='config set'){
    if(args[2]==='agents.list[0].workspace')main.workspace=args[3];
    else if(args[2]==='agents.list[0].tools.deny')mainDeny=JSON.parse(args[3]);
    else throw new Error(`Unexpected config key ${args[2]}`);
    stdout='ok';
  }else if(key==='agents set-identity')stdout='{}';
  else if(key==='config validate')stdout='valid';
  else throw new Error(`Unexpected ${args.join(' ')}`);
  return {status:0,stdout,stderr:''};
};
assert.equal(reuseMainAgent(mainRoot,mainCommand).agent,'main');
assert.equal(main.workspace,path.join(mainRoot,'data','openclaw-main-workspace'));
assert.deepEqual(mainDeny,['message','sessions_send','gateway']);
assert.equal(existsSync(path.join(mainRoot,'data','private-backups','openclaw-before-main-repurpose.json')),true);
const agentFile=path.join(main.workspace,'AGENTS.md');
writeFileSync(agentFile,'customized');
reuseMainAgent(mainRoot,mainCommand);
assert.equal(readFileSync(agentFile,'utf8'),'customized');
console.log('PASS dedicated REI agent setup and existing agent protection');
