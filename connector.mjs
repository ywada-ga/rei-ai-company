import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const root=path.dirname(fileURLToPath(import.meta.url));
const configPath=process.env.REI_CONNECTOR_CONFIG||path.join(root,'data','connector.json');
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
function validateHub(value) {
  const url=new URL(value);
  if(url.protocol==='https:')return;
  if(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))return;
  throw new Error('HubはHTTPS、またはSSH転送したローカルURLを指定してください');
}
function extractAnswer(payload) {
  const found=[];
  const visit=(value,depth=0)=>{
    if(depth>8||value==null)return;
    if(Array.isArray(value))return value.forEach(item=>visit(item,depth+1));
    if(typeof value==='object') {if(typeof value.text==='string')found.push(value.text);for(const [key,item] of Object.entries(value))if(key!=='text'&&!['usage','metadata','model','session'].includes(key))visit(item,depth+1);}
  };
  visit(payload);
  return found.at(-1)||payload?.response||JSON.stringify(payload);
}
function runOpenClaw(agent,job,devices) {
  const list=devices.map(d=>({id:d.id,label:d.label,capabilities:d.capabilities}));
  const instruction=job.kind==='plan'
    ? `あなたはREIというAI秘書の計画担当です。実行はしないでください。次の依頼を1〜12個の仕事に分け、JSONだけで返してください。形式: {"steps":[{"title":"短い仕事名","prompt":"担当AIへ渡す具体的な指示","department":"operations|research|production|sales|support|people","deviceId":"指定する場合は登録端末ID","human":false}]}。利用可能な端末: ${JSON.stringify(list)}。人への依頼が必要ならhuman:true。端末指定が不要ならdeviceIdを省略。実行できない部分は正直に記述。依頼: ${job.text}`
    : `あなたはREIから仕事を任されたAI担当者です。依頼を実行し、実施結果と未実施の部分を区別して日本語で簡潔に報告してください。分からないことだけ質問してください。依頼: ${job.text}`;
  return new Promise((resolve,reject)=>{
    const key=`agent:${agent}:rei-${job.kind}-${job.id}`;
    const child=spawn('openclaw',['agent','--agent',agent,'--session-key',key,'--message',instruction,'--json','--timeout','180'],{stdio:['ignore','pipe','pipe']});
    let out='',err='';const timer=setTimeout(()=>child.kill('SIGTERM'),195000);
    child.stdout.on('data',chunk=>{out+=chunk;if(out.length>2_000_000)child.kill('SIGTERM');});
    child.stderr.on('data',chunk=>{err+=chunk;if(err.length>100_000)child.kill('SIGTERM');});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error(`OpenClaw終了コード ${code}: ${err.slice(-500)}`));try{resolve(extractAnswer(JSON.parse(out)).slice(0,100000));}catch{resolve(out.trim().slice(0,100000));}});
  });
}
async function main() {
  if(process.argv[2]==='setup')return setup();
  const config=JSON.parse(readFileSync(configPath,'utf8'));
  validateHub(config.hub);
  const endpoint=new URL('/api',config.hub).toString();
  async function api(route,data={}) {
    const url=`${endpoint}?route=${encodeURIComponent(route)}`;
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${config.token}`},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);return result;
  }
  let lastHeartbeat=0;
  console.log(`REI Connector: ${config.hub} / agent=${config.agent}`);
  while(true) {
    try {
      if(Date.now()-lastHeartbeat>15000) {await api('connector/heartbeat',{capabilities:['openclaw','planning','execution']});lastHeartbeat=Date.now();}
      const {job,devices}=await api('connector/claim');
      if(!job) {if(process.argv.includes('--once'))break;await sleep(3000);continue;}
      console.log(`${job.kind} ${job.id}: ${job.text.slice(0,80)}`);
      const renewal=setInterval(()=>void api('connector/renew',{taskId:job.id,leaseId:job.lease_id}).catch(e=>console.error('リース更新:',e.message)),30000);
      let result='',error='',success=false;
      try {result=await runOpenClaw(config.agent,job,devices);success=true;}
      catch(e) {error=e.message;}
      finally {clearInterval(renewal);}
      const ack=await api('connector/result',{taskId:job.id,leaseId:job.lease_id,success,result,error});
      console.log(`${job.id}: ${ack.ok?'報告完了':'結果照合が必要'}`);
      if(process.argv.includes('--once'))break;
    } catch(e) {console.error('接続/実行:',e.message);if(process.argv.includes('--once'))process.exitCode=1;else await sleep(5000);if(process.argv.includes('--once'))break;}
  }
}
await main();
