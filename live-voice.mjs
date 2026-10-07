import crypto from 'node:crypto';
import {readFileSync,writeFileSync,lstatSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {one,run,transaction} from './storage.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function key(root,create=false){
 const file=path.join(process.env.REI_DATA_DIR||path.join(root,'data'),'voice.key');
 const stat=lstatSync(file,{throwIfNoEntry:false});
 if(!stat){if(!create)throw fail('音声APIの暗号鍵をバックアップから復元してください',409);writeFileSync(file,crypto.randomBytes(32),{mode:0o600,flag:'wx'});}
 else if(!stat.isFile()||stat.isSymbolicLink())throw fail('音声APIの暗号鍵を確認してください',409);
 chmodSync(file,0o600);const bytes=readFileSync(file);if(bytes.length!==32)throw fail('音声APIの暗号鍵が壊れています',409);return bytes;
}
function apiKey(db,root){const value=one(db,"SELECT value FROM settings WHERE key='voice_api_key'")?.value;if(!value)throw fail('自然な会話にはOpenAI APIキーの設定が必要です',409);const bytes=Buffer.from(value,'base64');const cipher=crypto.createDecipheriv('aes-256-gcm',key(root),bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}
export function liveVoiceStatus(db,root){const configured=!!one(db,"SELECT value FROM settings WHERE key='voice_api_key'");let needsAttention=false;if(configured)try{apiKey(db,root);}catch{needsAttention=true;}return {configured,needsAttention,model:'gpt-live-1',maxMinutes:5};}
export function configureLiveVoice(db,root,input){
 if(input.consent!==true)throw fail('API料金とOpenAIへの音声・会社情報の送信を確認してください');
 if(typeof input.apiKey!=='string'||!/^sk-[A-Za-z0-9_-]{12,}$/.test(input.apiKey)||input.apiKey.length>1000)throw fail('OpenAI APIキーの形式を確認してください');
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(root,true),iv);const body=Buffer.concat([cipher.update(input.apiKey,'utf8'),cipher.final()]);
 transaction(db,()=>run(db,"INSERT INTO settings(key,value) VALUES('voice_api_key',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64')));
 return liveVoiceStatus(db,root);
}
export const liveInstructions='あなたは会社のAI秘書REIです。日本語で、親しい同僚と話すように落ち着いて自然に会話してください。短い相づち、自然な抑揚と間を使い、台本の朗読や毎回の定型挨拶を避けてください。相手が話し始めたら説明を止め、言い直しを聞いてください。人間であると偽らないでください。会社・社員・案件・予定・数字・過去の決定に関する事実は必ずclientへ委任し、SynapseConnectの記録を確認した結果だけで答えてください。確認中にも会話は続けられますが、確認していない事実を埋めないでください。雑談・挨拶は直接応答してください。委任する前に、対象が曖昧なら短く確認してください。結果の未確認・アクセス不可はそのまま伝え、記録IDは読み上げないでください。依頼の実行・外部送信・記録の変更はできません。情報の確認と提案だけを行い、実行するときは画面で依頼するよう案内してください。';
export class LiveVoiceSessions {
 constructor({fetcher=globalThis.fetch,maxDurationMs=300000}={}){this.fetcher=fetcher;this.maxDurationMs=maxDurationMs;this.sessions=new Map();this.starting=new Set();}
 async create(db,root,userId,sdp){
  if(typeof sdp!=='string'||sdp.length>100000||!sdp.startsWith('v=0'))throw fail('音声接続の形式を確認してください');
  if(this.starting.has(userId)||[...this.sessions.values()].some(s=>s.userId===userId))throw fail('このアカウントの音声会話が既に接続中です',409);
  const token=apiKey(db,root);this.starting.add(userId);
  try{
   const response=await this.fetcher('https://api.openai.com/v1/live/sessions',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','OpenAI-Safety-Identifier':crypto.createHash('sha256').update(userId).digest('hex')},body:JSON.stringify({session:{model:'gpt-live-1',instructions:liveInstructions,delegation:{type:'client'},audio:{output:{voice:'marin'}},store:false},transport:{type:'webrtc',sdp}}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw fail(`OpenAI音声接続を開始できません（HTTP ${response.status}）。APIの利用資格・残高を確認してください`,502);
   const result=await response.json();const providerId=result.session?.id,answer=result.transport?.sdp;
   if(typeof providerId!=='string'||!/^[^\u0000-\u001f\u007f]{1,200}$/.test(providerId)||typeof answer!=='string'||!answer.startsWith('v=0'))throw fail('音声サービスから接続情報を受け取れませんでした',502);
   const id=crypto.randomUUID(),session={userId,providerId,token,timer:null};this.sessions.set(id,session);
   session.timer=setTimeout(()=>void this.close(userId,id).catch(()=>{}),this.maxDurationMs);session.timer.unref?.();
   return {id,sdp:answer,maxMinutes:5};
  }finally{this.starting.delete(userId);}
 }
 async close(userId,id){
  const session=this.sessions.get(id);if(!session)return {ok:true};if(session.userId!==userId)throw fail('別の利用者の音声会話は終了できません',403);
  clearTimeout(session.timer);
  try{
   const response=await this.fetcher(`https://api.openai.com/v1/live/sessions/${encodeURIComponent(session.providerId)}/hangup`,{method:'POST',headers:{authorization:`Bearer ${session.token}`},signal:AbortSignal.timeout(10000)});
   if(!response.ok&&response.status!==404)throw fail('音声サービスでの終了を確認できませんでした',502);
   this.sessions.delete(id);return {ok:true};
  }catch(error){session.timer=setTimeout(()=>void this.close(userId,id).catch(()=>{}),10000);session.timer.unref?.();throw error;}
 }
}
