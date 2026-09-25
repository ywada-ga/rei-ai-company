import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkOpenClaw, runOpenClawCli } from './openclaw-process.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
const configPath=process.env.REI_CONNECTOR_CONFIG||path.join(process.env.REI_DATA_DIR||path.join(root,'data'),'connector.json');
let problems=0;
function result(ok,message) {console.log(`${ok?'OK':'要確認'}  ${message}`);if(!ok)problems++;}

result(Number(process.versions.node.split('.')[0])>=24,`Node.js ${process.versions.node}（24以降が必要）`);
try {
  const openclaw=checkOpenClaw();
  const ready=!openclaw.error&&openclaw.status===0;
  result(ready,ready?'OpenClaw CLIを起動できます':'OpenClaw CLIを起動できません');
} catch {result(false,'OpenClaw CLIを起動できません');}

if(!existsSync(configPath))result(false,'REIの接続設定がありません。画面の「かんたん端末追加」から接続してください');
else {
  try {
    const config=JSON.parse(readFileSync(configPath,'utf8'));
    const url=new URL(config.hub);
    const safe=url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    if(!safe||typeof config.token!=='string'||!config.token||typeof config.agent!=='string'||!config.agent)throw new Error('接続設定の形式が正しくありません');
    result(true,'REIの接続設定を読み取りました');
    try {
      const response=await fetch(new URL('/api?route=setup%2Fstatus',url),{signal:AbortSignal.timeout(10000)});
      result(response.ok,response.ok?'中心PCのREIに接続できます':'中心PCのREIが正常に応答しません');
      if(response.ok) {
        const authorized=await fetch(new URL('/api?route=connector%2Fstatus',url),{headers:{authorization:`Bearer ${config.token}`},signal:AbortSignal.timeout(10000)});
        result(authorized.ok,authorized.ok?'端末トークンは中心PCで有効です':'端末トークンが無効です。中心PCで端末の登録状態を確認してください');
        if(authorized.ok) {
          const status=await authorized.json();
          result(status.hubVersion===version,status.hubVersion===version?`REIの版は一致しています（${version}）`:`REIの版が異なります。このPCは${version}、中心PCは${status.hubVersion||'不明'}です`);
        }
      }
    } catch {result(false,'中心PCのREIに接続できません。Tailscaleまたは中心PCの稼働状態を確認してください');}
    try {
      const agents=runOpenClawCli(['agents','list','--json']);
      const list=agents.status===0?JSON.parse(agents.stdout):[];
      result(Array.isArray(list)&&list.some(agent=>agent.id===config.agent),`OpenClawの担当AI「${config.agent}」`);
    } catch {result(false,'OpenClawの担当AIを確認できません');}
  } catch {result(false,'REIの接続設定を読み取れません。保存済みファイルは変更していません');}
}
const pending=path.join(path.dirname(configPath),'pending-results.json');
result(!existsSync(`${pending}.tmp`),existsSync(`${pending}.tmp`)?'送信待ち結果の保存途中ファイルが残っています':'送信待ち結果の保存途中ファイルなし');
if(existsSync(pending)) {
  try {
    const records=JSON.parse(readFileSync(pending,'utf8'));
    const valid=Array.isArray(records)&&records.every(item=>item&&typeof item.taskId==='string'&&typeof item.leaseId==='string'&&typeof item.success==='boolean'&&typeof item.result==='string'&&typeof item.error==='string');
    result(valid&&records.length===0,!valid?'送信待ち結果の形式が正しくありません':records.length?`送信待ち結果 ${records.length}件。Hubの仕事と照合してください`:'送信待ち結果 0件');
  } catch {result(false,'送信待ち結果を読み取れません');}
}
console.log(problems?`診断完了: ${problems}件を確認してください`:'診断完了: 接続の基本項目は正常です');
if(problems)process.exitCode=1;
