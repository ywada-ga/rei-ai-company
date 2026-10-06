import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runOpenClawCli } from './openclaw-process.mjs';

const readTools=['list_groups','survey_space','search_memory_facts','search_episodes','get_episode','get_fact_source','search_nodes','explore_from','find_contradictions','get_updates','get_source_url','get_library_document','list_library_documents','get_episode_output'];
export function syncSynapseAgentAccess(configPath,agent,integrations,command=runOpenClawCli) {
  const file=path.join(path.dirname(configPath),'synapse-tool-access.json');
  if(existsSync(`${file}.tmp`))throw new Error('SynapseConnectの担当AI設定が保存途中です。設定ファイルを確認してください');
  const saved=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{agent,names:[]};
  if(saved.agent!==agent||!Array.isArray(saved.names)||saved.names.some(name=>typeof name!=='string'||!/^rei_[a-f0-9]{12}__(?:[a-z_]+)$/.test(name)))throw new Error('SynapseConnectの担当AI設定を確認してください');
  const names=integrations.filter(item=>item.url==='https://mcp.synapse-connect.ai/mcp').flatMap(item=>{
    if(!/^rei_[a-f0-9]{12}$/.test(item.name))throw new Error('SynapseConnectの連携名が正しくありません');
    return readTools.map(tool=>`${item.name}__${tool}`);
  });
  if(!names.length&&!saved.names.length)return;
  const checked=args=>{
    const result=command(args);
    if(result.error||result.status!==0)throw new Error('SynapseConnectの読み取りツールを担当AIへ公開できませんでした');
    return String(result.stdout||'');
  };
  const agents=JSON.parse(checked(['config','get','agents']));
  const index=agents.list?.findIndex(entry=>entry.id===agent)??-1;
  const entry=index>=0?agents.list[index]:agents.entries?.[agent];
  if(!entry)throw new Error('SynapseConnectを使う担当AIが見つかりません');
  const current=entry.tools?.alsoAllow||[];
  const baseline=current.filter(name=>!saved.names.includes(name));
  const managedNames=names.filter(name=>!baseline.includes(name));
  const next=[...new Set([...baseline,...names])];
  if(JSON.stringify(current)!==JSON.stringify(next)) {
    const config=checked(['config','file']).trim().replace(/^~(?=\/)/,os.homedir());
    const backups=path.join(path.dirname(configPath),'private-backups');mkdirSync(backups,{recursive:true,mode:0o700});
    const backup=path.join(backups,'openclaw-before-synapse-access.json');
    if(existsSync(config)&&!existsSync(backup)){copyFileSync(config,backup);chmodSync(backup,0o600);}
    const key=index>=0?`agents.list[${index}].tools.alsoAllow`:`agents.entries.${agent}.tools.alsoAllow`;
    checked(['config','set',key,JSON.stringify(next),'--strict-json']);
  }
  const temporary=`${file}.tmp`;
  writeFileSync(temporary,JSON.stringify({agent,names:managedNames}),{mode:0o600,flag:'wx',flush:true});renameSync(temporary,file);
}
