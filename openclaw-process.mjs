import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

function windowsEntry() {
  const override=process.env.REI_OPENCLAW_ENTRY;
  if(override&&existsSync(override))return override;
  const bins=String(process.env.PATH||'').split(path.delimiter);
  for(const bin of bins) {
    const cmd=path.join(bin,'openclaw.cmd');
    if(!existsSync(cmd))continue;
    const entry=path.join(bin,'node_modules','openclaw','openclaw.mjs');
    if(existsSync(entry))return entry;
  }
  throw new Error('OpenClaw CLIの本体が見つかりません。公式のWindows向けCLIをインストールしてください');
}

export function checkOpenClaw() {
  if(process.platform==='win32')return spawnSync(process.execPath,[windowsEntry(),'--version'],{encoding:'utf8',windowsHide:true});
  return spawnSync('openclaw',['--version'],{encoding:'utf8'});
}

export function runOpenClawCli(args) {
  if(process.platform==='win32')return spawnSync(process.execPath,[windowsEntry(),...args],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  return spawnSync('openclaw',args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
}

export function spawnOpenClaw(agent,key,instruction) {
  if(process.platform==='win32')return spawn(process.execPath,[windowsEntry(),'agent','--agent',agent,'--session-key',key,'--message',instruction,'--json','--timeout','180'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  return spawn('openclaw',['agent','--agent',agent,'--session-key',key,'--message',instruction,'--json','--timeout','180'],{stdio:['ignore','pipe','pipe']});
}

export function parseOpenClawResult(output) {
  let payload;
  try {payload=JSON.parse(output);} catch {throw new Error('OpenClawからJSON形式の結果を受け取れませんでした');}
  if(payload?.status&&payload.status!=='ok')throw new Error(`OpenClawの処理状態: ${String(payload.status).slice(0,100)}`);
  if(payload?.result?.meta?.aborted)throw new Error('OpenClawの処理が中断されました');
  const texts=payload?.result?.payloads?.map(item=>item?.text).filter(item=>typeof item==='string'&&item.trim());
  const answer=texts?.at(-1)||payload?.response||payload?.result?.text;
  if(typeof answer!=='string'||!answer.trim())throw new Error('OpenClawから回答を受け取れませんでした');
  if(/(?:^|\n)\s*⚠️\s*🛠️\s*(?:Bash|Tool) failed:/i.test(answer))throw new Error(`OpenClawの操作結果を確認してください: ${answer.slice(0,500)}`);
  return answer.trim().slice(0,100000);
}
