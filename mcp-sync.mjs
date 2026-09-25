import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { runOpenClawCli } from './openclaw-process.mjs';

function readManaged(file) {
  if(existsSync(`${file}.tmp`))throw new Error(`MCP設定の保存途中ファイルがあります。${file}.tmp を確認してください`);
  if(!existsSync(file))return {};
  let value;
  try {value=JSON.parse(readFileSync(file,'utf8'));}
  catch {throw new Error(`MCP設定の記録を読み取れません。${file} を確認してください`);}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`MCP設定の記録が不正です。${file} を確認してください`);
  return value;
}
const result=output=>{if(output.status!==0)throw new Error((output.stderr||output.stdout||output.error?.message||'OpenClaw MCPエラー').slice(-1200));return output.stdout;};
export function syncMcp(configPath,integrations,command=runOpenClawCli) {
  const statePath=path.join(path.dirname(configPath),'mcp-sync.json');
  const managed=readManaged(statePath);
  if(!Array.isArray(integrations)||integrations.length>100)throw new Error('MCP連携の数が正しくありません');
  const desired={};
  for(const item of integrations) {
    if(!/^rei_[a-f0-9]{12}$/.test(item.name)||!['oauth','none'].includes(item.auth))throw new Error('MCP設定が正しくありません');
    const url=new URL(item.url);
    if(url.protocol!=='https:'||url.username||url.password||url.hash||url.href.length>1000)throw new Error('MCP URLが正しくありません');
    desired[item.name]={url:url.toString(),auth:item.auth};
  }
  const existing=readJsonResult(result(command(['mcp','list','--json'])));
  const save=()=>{const temp=`${statePath}.tmp`;writeFileSync(temp,JSON.stringify(managed),{mode:0o600,flag:'wx',flush:true});renameSync(temp,statePath);};
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
const safeError=value=>String(value||'接続に失敗しました').replace(/https?:\/\/\S+/g,'[URL]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,400);
export function probeMcp(name,command=runOpenClawCli) {
  if(!/^rei_[a-f0-9]{12}$/.test(name))throw new Error('MCP名が正しくありません');
  let output;
  try {output=command(['mcp','probe',name,'--json']);}
  catch(error) {return {status:'error',toolCount:0,error:safeError(error.message)};}
  if(output.status!==0)return {status:'error',toolCount:0,error:safeError(output.stderr||output.stdout||output.error?.message)};
  let data;
  try {data=JSON.parse(output.stdout);} catch {return {status:'error',toolCount:0,error:'OpenClawの検査結果を読み取れませんでした'};}
  const server=data.servers?.[name];
  if(!server)return {status:'error',toolCount:0,error:safeError(data.diagnostics?.[0]?.message||'MCPサーバーに接続できませんでした')};
  if(Array.isArray(data.diagnostics)&&data.diagnostics.length)return {status:'error',toolCount:0,error:safeError(data.diagnostics.map(item=>item.message||item.error||item).join('; '))};
  const toolCount=Number.isSafeInteger(server.tools)?server.tools:Array.isArray(data.tools)?data.tools.filter(tool=>String(tool).startsWith(`${name}__`)).length:0;
  return {status:'success',toolCount,error:''};
}
