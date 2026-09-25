import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { checkOpenClaw, spawnOpenClaw, parseOpenClawResult } from './openclaw-process.mjs';
import { syncMcp, probeMcp } from './mcp-sync.mjs';
import { ensureReiAgent } from './rei-agent.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const configPath=process.env.REI_CONNECTOR_CONFIG||path.join(root,'data','connector.json');
const pendingPath=path.join(path.dirname(configPath),'pending-results.json');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function setup() {
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try {
    const hub=(await rl.question('REI Hub URL（このPCなら http://127.0.0.1:4178）: ')).trim();
    const token=(await rl.question('端末登録で発行されたトークン: ')).trim();
    const agent=(await rl.question('OpenClawエージェント名（空欄で main）: ')).trim()||'main';
    validateHub(hub);
    if(!token)throw new Error('トークンが必要です');
    mkdirSync(path.dirname(configPath),{recursive:true,mode:0o700});
    writeFileSync(configPath,JSON.stringify({hub,token,agent},null,2),{mode:0o600});
    chmodSync(configPath,0o600);
    console.log(`設定を保存しました: ${configPath}`);
  } finally {rl.close();}
}
async function join() {
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try {
    if(existsSync(configPath))throw new Error('このPCには既にREIの接続設定があります。既存設定を確認してから再登録してください');
    const hub=(process.argv[3]||await rl.question('REIの接続URL: ')).trim().replace(/\/$/,'');
    validateHub(hub);
    const available=checkOpenClaw();
    if(available.status!==0)throw new Error('このPCにOpenClaw CLIがありません。先にOpenClawをセットアップしてください');
    ensureReiAgent(root);
    const code=(await rl.question('REI画面に表示された16文字の接続コード: ')).trim();
    const response=await fetch(new URL('/api?route=connector%2Fpair',hub),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||`接続に失敗しました (HTTP ${response.status})`);
    mkdirSync(path.dirname(configPath),{recursive:true,mode:0o700});
    writeFileSync(configPath,JSON.stringify({hub,token:result.token,agent:'rei'},null,2),{mode:0o600,flag:'wx'});
    chmodSync(configPath,0o600);
    if(['darwin','win32','linux'].includes(process.platform)) {
      const installer={darwin:'install-macos.mjs',win32:'install-windows.mjs',linux:'install-linux.mjs'}[process.platform];
      const installed=spawnSync(process.execPath,[path.join(root,installer),'connector'],{cwd:root,encoding:'utf8'});
      if(installed.status!==0)throw new Error(`端末は登録されましたが自動起動に失敗しました: ${installed.stderr||installed.stdout}`);
      console.log('接続完了。このPCのOpenClawがREIの仕事を受け取れます。');
    } else console.log('接続情報を保存しました。npm run connector で起動してください。');
  } finally {rl.close();}
}
function validateHub(value) {
  const url=new URL(value);
  if(url.protocol==='https:')return;
  if(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))return;
  throw new Error('HubはHTTPS、またはSSH転送したローカルURLを指定してください');
}
function loadPending() {try {const value=JSON.parse(readFileSync(pendingPath,'utf8'));return Array.isArray(value)?value:[];}catch{return [];}}
function savePending(items) {const temp=`${pendingPath}.tmp`;writeFileSync(temp,JSON.stringify(items),{mode:0o600});renameSync(temp,pendingPath);}
function runOpenClaw(agent,job,devices) {
  const list=devices.map(d=>({id:d.id,label:d.label,capabilities:d.capabilities}));
  const projectContext=job.project?`所属プロジェクト: ${job.project.name}。達成目的: ${job.project.objective}。この目的を踏まえて依頼を進めてください。`:'';
  const instruction=job.kind==='plan'
    ? `あなたはREIというAI秘書の計画担当です。実行はしないでください。次の依頼を1〜12個の仕事に分け、JSONだけで返してください。各工程は他の工程を待たずに着手できる独立した仕事にしてください。順序が必要な作業は同じ工程にまとめてください。形式: {"steps":[{"title":"短い仕事名","prompt":"担当AIへ渡す具体的な指示","department":"operations|research|production|sales|support|people","deviceId":"指定する場合は登録端末ID","human":false}]}。利用可能な端末: ${JSON.stringify(list)}。人への依頼が必要ならhuman:true。端末指定が不要ならdeviceIdを省略。実行できない部分は正直に記述。${projectContext}依頼: ${job.text}`
    : `あなたはREIから仕事を任されたAI担当者です。依頼を実行し、実施結果と未実施の部分を区別して日本語で簡潔に報告してください。分からないことだけ質問してください。${projectContext}依頼: ${job.text}`;
  return new Promise((resolve,reject)=>{
    const key=`agent:${agent}:rei-${job.kind}-${job.id}`;
    const child=spawnOpenClaw(agent,key,instruction);
    let out='',err='';const timer=setTimeout(()=>child.kill('SIGTERM'),195000);
    child.stdout.on('data',chunk=>{out+=chunk;if(out.length>2_000_000)child.kill('SIGTERM');});
    child.stderr.on('data',chunk=>{err+=chunk;if(err.length>100_000)child.kill('SIGTERM');});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error(`OpenClaw終了コード ${code}: ${err.slice(-500)}`));try{resolve(parseOpenClawResult(out));}catch(e){reject(e);}});
  });
}
async function main() {
  if(process.argv[2]==='setup')return setup();
  if(process.argv[2]==='join')return join();
  const config=JSON.parse(readFileSync(configPath,'utf8'));
  validateHub(config.hub);
  const endpoint=new URL('/api',config.hub).toString();
  async function api(route,data={}) {
    const url=`${endpoint}?route=${encodeURIComponent(route)}`;
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${config.token}`},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);return result;
  }
  let lastHeartbeat=0;
  let lastMcpSync=0,mcpSignature='',mcpStatuses=[],mcpDefinitions=[];
  let pending=loadPending();
  console.log(`REI Connector: ${config.hub} / agent=${config.agent}`);
  while(true) {
    try {
      if(Date.now()-lastHeartbeat>15000) {
        const heartbeat=await api('connector/heartbeat',{agentName:config.agent,capabilities:['openclaw','planning','execution',...mcpStatuses.filter(item=>item.status==='configured').map(item=>`mcp:${mcpDefinitions.find(definition=>definition.name===item.name)?.label||item.name}`)],mcpStatuses});
        lastHeartbeat=Date.now();
        const integrations=heartbeat.integrations||[],signature=JSON.stringify(integrations);
        mcpDefinitions=integrations;
        if(signature!==mcpSignature||Date.now()-lastMcpSync>60000) {
          try {mcpStatuses=syncMcp(configPath,integrations);mcpSignature=signature;lastMcpSync=Date.now();}
          catch(e) {console.error('MCP連携:',e.message);mcpStatuses=integrations.map(item=>({name:item.name,status:'error'}));lastMcpSync=Date.now();}
        }
        for(const check of heartbeat.checks||[]) {
          const integration=integrations.find(item=>item.name===check.name);
          if(!integration)continue;
          const configured=mcpStatuses.find(item=>item.name===check.name)?.status;
          const outcome=configured==='auth_required'?{status:'auth_required',toolCount:0,error:'対象PCでOpenClawのOAuth認証が必要です'}:configured==='error'?{status:'error',toolCount:0,error:'対象PCでMCP設定を確認できません'}:probeMcp(check.name);
          await api('connector/mcp-check-result',{name:check.name,requestId:check.request_id,...outcome});
        }
      }
      if(pending.length) {
        const item=pending[0];
        const ack=await api('connector/result',item);
        console.log(`${item.taskId}: ${ack.needsReview?'遅れて届いた結果を保存。実施状況の確認が必要':ack.ok?'保存済みの結果を再送':'結果の手動照合が必要'}`);
        pending.shift();savePending(pending);
        if(process.argv.includes('--once'))break;
        continue;
      }
      const {job,devices}=await api('connector/claim');
      if(!job) {if(process.argv.includes('--once'))break;await sleep(3000);continue;}
      console.log(`${job.kind} ${job.id}: ${job.text.slice(0,80)}`);
      const renewal=setInterval(()=>void api('connector/renew',{taskId:job.id,leaseId:job.lease_id}).catch(e=>console.error('リース更新:',e.message)),30000);
      let result='',error='',success=false;
      try {result=await runOpenClaw(config.agent,job,devices);success=true;}
      catch(e) {error=e.message;}
      finally {clearInterval(renewal);}
      pending.push({taskId:job.id,leaseId:job.lease_id,success,result,error});savePending(pending);
      const ack=await api('connector/result',pending[0]);
      console.log(`${job.id}: ${ack.needsReview?'遅れて届いた結果を保存。実施状況の確認が必要':ack.ok?'報告完了':'結果照合が必要'}`);
      pending.shift();savePending(pending);
      if(process.argv.includes('--once'))break;
    } catch(e) {console.error('接続/実行:',e.message);if(process.argv.includes('--once'))process.exitCode=1;else await sleep(5000);if(process.argv.includes('--once'))break;}
  }
}
await main();
