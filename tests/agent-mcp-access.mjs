import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {syncSynapseAgentAccess} from '../agent-mcp-access.mjs';
const dir=mkdtempSync(path.join(os.tmpdir(),'rei-synapse-access-'));
const configFile=path.join(dir,'openclaw.json'),connector=path.join(dir,'connector.json');
const preexisting='rei_abcdef123456__list_groups';
const agents={list:[{id:'main',tools:{profile:'coding',deny:['message','gateway'],alsoAllow:['custom_tool',preexisting]}}]};
writeFileSync(configFile,JSON.stringify(agents));let writes=0;
const command=args=>{
  if(args[0]!=='config')throw new Error('unexpected command');
  if(args[1]==='file')return {status:0,stdout:configFile};
  if(args[1]==='get')return {status:0,stdout:JSON.stringify(agents)};
  if(args[1]==='set'){assert.equal(args[2],'agents.list[0].tools.alsoAllow');agents.list[0].tools.alsoAllow=JSON.parse(args[3]);writes++;return {status:0,stdout:''};}
  throw new Error('unexpected config operation');
};
try {
 const integrations=[{name:'rei_abcdef123456',url:'https://mcp.synapse-connect.ai/mcp'}];
 syncSynapseAgentAccess(connector,'main',integrations,command);
 const names=agents.list[0].tools.alsoAllow;
 assert.ok(names.includes('custom_tool'));assert.ok(names.includes('rei_abcdef123456__search_episodes'));
 assert.ok(!names.some(name=>/add_memory|get_auth_config|get_jev_credential|register_|submit_/.test(name)));
 assert.deepEqual(agents.list[0].tools.deny,['message','gateway']);
 assert.deepEqual(JSON.parse(readFileSync(path.join(dir,'private-backups/openclaw-before-synapse-access.json'))),{list:[{id:'main',tools:{profile:'coding',deny:['message','gateway'],alsoAllow:['custom_tool',preexisting]}}]});
 syncSynapseAgentAccess(connector,'main',integrations,command);assert.equal(writes,1);
 syncSynapseAgentAccess(connector,'main',[],command);
 assert.deepEqual(agents.list[0].tools.alsoAllow,['custom_tool',preexisting]);
 console.log('PASS Synapse reading tools reach the assigned AI while existing tool policy is preserved');
}finally{rmSync(dir,{recursive:true,force:true});}
