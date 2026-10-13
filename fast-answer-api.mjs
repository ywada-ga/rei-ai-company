import crypto from 'node:crypto';
import path from 'node:path';
import {mkdirSync,chmodSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {readResponseStream,provisionalDecisionFormat} from './chatgpt-plan.mjs';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
// This optional trial never receives a ChatGPT OAuth token. Keys, settings and
// attempt reservations are private to one REI user in the existing data area.
export class FastAnswerApi {
  constructor(directory,{fetcher=fetch}={}){
    this.directory=directory;this.fetcher=fetcher;
    mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
    this.file=path.join(directory,'trial.json');this.keyFile=path.join(directory,'key');
    this.record=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{enabled:false,model:'',maxRequests:1,attempts:0};
  }
  save(){const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(this.record),{mode:0o600});chmodSync(temp,0o600);renameSync(temp,this.file);}
  key(){if(!existsSync(this.keyFile))writeFileSync(this.keyFile,crypto.randomBytes(32),{mode:0o600,flag:'wx'});chmodSync(this.keyFile,0o600);return readFileSync(this.keyFile);}
  secret(){if(!this.record.secret||!existsSync(this.keyFile))throw fail('APIキーを設定してください',409);const bytes=Buffer.from(this.record.secret,'base64'),decipher=crypto.createDecipheriv('aes-256-gcm',this.key(),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}
  status(){return {provider:'openai_api',configured:!!this.record.secret,enabled:this.record.enabled===true,model:this.record.model,maxRequests:this.record.maxRequests,attempts:this.record.attempts,remaining:Math.max(0,this.record.maxRequests-this.record.attempts),lastTiming:this.lastTiming||null};}
  configure(input){
    if(typeof input.enabled!=='boolean')throw fail('API試験の使用状態を選んでください');
    if(input.enabled&&input.paidConsent!==true)throw fail('API料金と送信する情報を確認してください');
    if(typeof input.model!=='string'||!/^[-a-zA-Z0-9_.]{1,100}$/.test(input.model))throw fail('APIモデル名を入力してください');
    if(!Number.isSafeInteger(input.maxRequests)||input.maxRequests<1||input.maxRequests>10||input.maxRequests<this.record.attempts)throw fail('試験回数の上限は使用済み回数以上、1〜10回で指定してください');
    let secret=this.record.secret;
    if(input.apiKey){
      if(typeof input.apiKey!=='string'||!/^sk-[a-zA-Z0-9_-]{12,}$/.test(input.apiKey)||input.apiKey.length>1000)throw fail('OpenAI APIキーの形式を確認してください');
      const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key(),iv),encrypted=Buffer.concat([cipher.update(input.apiKey,'utf8'),cipher.final()]);
      secret=Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
    }
    if(input.enabled&&!secret)throw fail('APIキーを設定してください',409);
    this.record={...this.record,enabled:input.enabled,model:input.model,maxRequests:input.maxRequests,secret};this.save();return this.status();
  }
  disable(){this.record.enabled=false;this.save();return this.status();}
  removeKey(){this.record.enabled=false;delete this.record.secret;this.save();return this.status();}
  async generate(messages,{signal,onDelta,phase}={}){
    if(phase!=='provisional_answer')throw fail('API試験は最初の暫定要点だけに使用できます');
    signal?.throwIfAborted();
    if(!this.record.enabled||!this.record.secret||this.record.attempts>=this.record.maxRequests)throw fail('API試験は停止中、または試験回数の上限です',409);
    const input=messages.filter(m=>m.role!=='system').map(m=>({role:m.role,content:m.content})),instructions=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
    const payload={model:this.record.model,instructions:instructions+'\n出力形式のdecisionフィールドへ判断JSONを返す。',input,store:false,stream:true,max_output_tokens:800,text:{format:provisionalDecisionFormat}};
    // Cap input/output size and persist an attempt BEFORE dispatch. Failed and
    // interrupted requests may be billed; they are never automatically retried.
    if(Buffer.byteLength(JSON.stringify(payload))>32000)throw fail('API試験の入力が大きすぎます');
    const token=this.secret();this.record.attempts++;this.save();const started=performance.now();this.lastTiming=null;
    try{
      const response=await this.fetcher('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(payload),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
      if(!response.ok)throw fail('API試験に接続できませんでした。キー・モデル・利用上限を確認してください',409);
      const headersMs=Math.round(performance.now()-started),result=await readResponseStream(response,{onDelta:raw=>{signal?.throwIfAborted();onDelta?.(raw);}});
      signal?.throwIfAborted();const timing={tokenMs:0,headersMs,...result.timing,totalMs:Math.round(performance.now()-started)};
      this.lastTiming=timing;return {...result,timing};
    }catch{throw fail('API試験を完了できませんでした。最新情報の回答を待ってください',409);}
  }
}

export function generateFirstAnswer(api,fallback,messages,options){
  const state=api.status();
  return options?.phase==='provisional_answer'&&state.enabled&&state.configured&&state.remaining>0?api.generate(messages,options):fallback.generate(messages,options);
}
