import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export function tailscaleExecutable(platform=process.platform,exists=existsSync,env=process.env) {
  const candidates=platform==='darwin'?['/usr/local/bin/tailscale','/opt/homebrew/bin/tailscale','/Applications/Tailscale.app/Contents/MacOS/Tailscale']:platform==='win32'?[path.join(env.ProgramFiles||'C:\\Program Files','Tailscale','tailscale.exe')]:[];
  return candidates.find(candidate=>exists(candidate))||'tailscale';
}
export function runTailscale(args) {
  return spawnSync(tailscaleExecutable(),args,{encoding:'utf8',timeout:15000,maxBuffer:256000,windowsHide:true,env:{...process.env,TAILSCALE_BE_CLI:'1'}});
}
export function networkStatus(command=runTailscale,port=Number(process.env.REI_PORT||4178)) {
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('REIのポート番号が正しくありません');
  const result=command(['status','--json']);
  if(result.error?.code==='ENOENT')return {state:'missing',url:null};
  if(result.status!==0)return {state:'login_required',url:null};
  let status;
  try {status=JSON.parse(result.stdout);}catch{return {state:'error',url:null};}
  if(status.BackendState!=='Running'||!status.Self?.DNSName)return {state:'login_required',url:null};
  const host=String(status.Self.DNSName).replace(/\.$/,'');
  if(!/^[a-z0-9.-]+\.ts\.net$/i.test(host))return {state:'error',url:null};
  const serve=command(['serve','status','--json']);
  if(serve.status!==0)return {state:'error',url:null};
  let config;
  try {config=JSON.parse(serve.stdout);}catch{return {state:'error',url:null};}
  const hostPort=`${host}:443`,handlers=config?.Web?.[hostPort]?.Handlers,handler=handlers?.['/'];
  let active=false;
  try {
    const target=new URL(handler?.Proxy);
    active=target.protocol==='http:'&&['127.0.0.1','localhost'].includes(target.hostname)&&Number(target.port)===port&&target.pathname==='/'&&config?.TCP?.['443']?.HTTPS===true;
  } catch {}
  if(config?.AllowFunnel?.[hostPort]===true)return {state:'public',url:null};
  if((handlers&&Object.keys(handlers).some(route=>route!=='/'))||(config?.TCP?.['443']&&!active)||handler&&!active)return {state:'conflict',url:null};
  return {state:active?'connected':'ready',url:active?`https://${host}`:null};
}
export function enableServe(command=runTailscale,port=Number(process.env.REI_PORT||4178)) {
  const current=networkStatus(command,port);
  if(current.state==='public')throw new Error('公開用のTailscale Funnelが有効です。Funnelを無効にしてから再確認してください');
  if(current.state==='conflict')throw new Error('Tailscaleの入口は別のサービスに使われています。既存の設定を確認してください');
  if(current.state!=='ready'&&current.state!=='connected')throw new Error('先にTailscaleをインストールしてログインしてください');
  if(current.state==='connected')return current;
  const result=command(['serve','--bg',String(port)]);
  if(result.status!==0)throw new Error('安全な接続を有効にできません。Tailscaleの画面でHTTPSの案内を完了してください');
  const updated=networkStatus(command,port);
  if(updated.state!=='connected')throw new Error('接続URLを確認できません。Tailscaleの設定を確認してください');
  return updated;
}
