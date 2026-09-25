import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { runOpenClawCli } from './openclaw-process.mjs';

const readJson=file=>{try{return JSON.parse(readFileSync(file,'utf8'));}catch{return {};}};
const result=output=>{if(output.status!==0)throw new Error((output.stderr||output.stdout||output.error?.message||'OpenClaw MCPエラー').slice(-1200));return output.stdout;};
export function syncMcp(configPath,integrations,command=runOpenClawCli) {
  const statePath=path.join(path.dirname(configPath),'mcp-sync.json');
  const managed=readJson(statePath);
  if(!Array.isArray(integrations)||integrations.length>100)throw new Error('MCP連携の数が正しくありません');
  const desired={};
  for(const item of integrations) {
    if(!/^rei_[a-f0-9]{12}$/.test(item.name)||!['oauth','none'].includes(item.auth))throw new Error('MCP設定が正しくありません');
    const url=new URL(item.url);
    if(url.protocol!=='https:'||url.username||url.password||url.hash||url.href.length>1000)throw new Error('MCP URLが正しくありません');
    desired[item.name]={url:url.toString(),auth:item.auth};
  }
  const existing=readJsonResult(result(command(['mcp','list','--json'])));
  const save=()=>{const temp=`${statePath}.tmp`;writeFileSync(temp,JSON.stringify(managed),{mode:0o600});renameSync(temp,statePath);};
  for(const [name,definition] of Object.entries(desired)) {
    if(existing[name]&&!managed[name])throw new Error(`${name} は既存のOpenClaw設定と重複しています`);
    if(existing[name]&&JSON.stringify(managed[name])===JSON.stringify(definition))continue;
    const config={url:definition.url,transport:'streamable-http',...(definition.auth==='oauth'?{auth:'oauth'}:{})};
    result(command(['mcp','set',name,JSON.stringify(config)]));
    managed[name]=definition;save();
  }
  for(const name of Object.keys(managed)) {
    if(desired[name])continue;
    if(existing[name])result(command(['mcp','unset',name]));
    delete managed[name];save();
  }
  const statuses=readJsonResult(result(command(['mcp','status','--json']))).servers||[];
  return integrations.map(item=>{
    const status=statuses.find(value=>value.name===item.name);
    if(!status?.ok)return {name:item.name,status:'error'};
    if(item.auth==='oauth'&&!status.authStatus?.hasTokens)return {name:item.name,status:'auth_required'};
    return {name:item.name,status:'configured'};
  });
}
function readJsonResult(output) {try{return JSON.parse(output);}catch{throw new Error('OpenClawのMCP状態を読み取れませんでした');}}
