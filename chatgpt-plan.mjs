import http from 'node:http';
import crypto from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,chmodSync,existsSync} from 'node:fs';
import path from 'node:path';
const issuer='https://auth.openai.com',resource='https://api.openai.com/v1';
const scopes='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random=()=>crypto.randomBytes(32).toString('base64url');
const failure=message=>Object.assign(new Error(message),{status:400});
const decisionFormat={type:'json_schema',name:'rei_decision',strict:true,schema:{type:'object',properties:{decision:{anyOf:Object.entries({answer:'text',search:'query',source:'uuid',episode:'uuid',work:'instruction'}).map(([action,key])=>({type:'object',properties:{action:{type:'string',enum:[action]},[key]:{type:'string'}},required:['action',key],additionalProperties:false})).concat([{type:'object',properties:{action:{type:'string',enum:['assess']},status:{type:'string',enum:['supported','partial','insufficient','ambiguous']},sourceIds:{type:'array',items:{type:'string'}},reason:{type:'string'},query:{type:'string'}},required:['action','status','sourceIds','reason','query'],additionalProperties:false},{type:'object',properties:{action:{type:'string',enum:['respond']},status:{type:'string',enum:['supported','partial','insufficient','ambiguous']},sourceIds:{type:'array',items:{type:'string'}},reason:{type:'string'},query:{type:'string'},text:{type:'string'}},required:['action','status','sourceIds','reason','query','text'],additionalProperties:false}])}},required:['decision'],additionalProperties:false}};
export function validateIdToken(token,keys,{clientId,nonce,subject,now=Date.now()}){
  try{
    const parts=token.split('.');if(parts.length!==3)throw 0;
    const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
    const key=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig'));
    if(header.alg!=='RS256'||!key||!crypto.verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),crypto.createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw 0;
    if(claims.iss!==issuer||!(Array.isArray(claims.aud)?claims.aud.includes(clientId):claims.aud===clientId)||!Number.isFinite(claims.exp)||claims.exp*1000<=now||!claims.sub||claims.nonce!==nonce||(claims.nbf&&claims.nbf*1000>now+30000)||(subject&&claims.sub!==subject))throw 0;
    if(Array.isArray(claims.aud)&&claims.aud.length>1&&claims.azp!==clientId)throw 0;
    return claims;
  }catch{throw failure('ChatGPTのログイン情報を検証できませんでした。再接続してください');}
}
export async function readResponseStream(response,{onDelta}={}){
  const started=performance.now();let firstDeltaMs=null;
  let buffer='',text='',completed=false;const decoder=new TextDecoder();
  const consume=block=>{
    const lines=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart());if(!lines.length)return;
    const raw=lines.join('\n');if(raw==='[DONE]')return;const event=JSON.parse(raw);
    if(event.type==='response.output_text.delta'){if(event.delta&&firstDeltaMs===null)firstDeltaMs=Math.round(performance.now()-started);text+=event.delta||'';onDelta?.(text);}
    if(['response.failed','response.incomplete','error'].includes(event.type))throw failure('ChatGPTの返答を完了できませんでした。利用枠または接続状態を確認してください');
    if(event.type==='response.completed')completed=true;
    if(text.length>50000)throw failure('ChatGPTの返答が長すぎます');
  };
  for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true}).replace(/\r\n/g,'\n');if(buffer.length>2000000)throw failure('ChatGPTの返答を読み取れません');let split;while((split=buffer.indexOf('\n\n'))>=0){consume(buffer.slice(0,split));buffer=buffer.slice(split+2);}}
  buffer+=decoder.decode();if(buffer.trim())consume(buffer);
  if(!completed||!text.trim())throw failure('ChatGPTの返答が途中で切れました。もう一度質問してください');return {text,timing:{streamFirstDeltaMs:firstDeltaMs,streamCompleteMs:Math.round(performance.now()-started)}};
}
export class ChatGPTPlan {
  constructor(directory,{fetcher=fetch}={}){
    this.directory=directory;this.fetcher=fetcher;this.file=path.join(directory,'account.json');
    mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
    this.record=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{hostId:`urn:uuid:${crypto.randomUUID()}`,accounts:[],active:null};
    this.save();this.lastError='';
  }
  save(){const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(this.record),{mode:0o600});chmodSync(temp,0o600);renameSync(temp,this.file);}
  account(){return this.record.accounts.find(a=>a.clientId===this.record.active);}
  status(){const account=this.account();return {provider:'chatgpt',configured:!!account?.accessToken,ready:!!account?.accessToken,pending:!!this.pending,model:account?.model||null,error:this.lastError,active:this.record.active,accounts:this.record.accounts.map(a=>({id:a.clientId,email:a.email||'ChatGPTアカウント',connected:!!a.accessToken,model:a.model||null})),models:account?.models||[]};}
  async json(url,options={}){
    const response=await this.fetcher(url,{...options,redirect:'error',signal:options.signal||AbortSignal.timeout(30000)});
    if(!response.ok)throw failure(response.status===429?'ChatGPTの利用枠に達しました。ChatGPTの利用状況を確認してください':'ChatGPTに接続できませんでした。ログインと利用権限を確認してください');
    return response.json();
  }
  stop(){const pending=this.pending;this.pending=null;if(pending){clearTimeout(pending.timer);pending.server.close();}}
  async begin({accountId=null}={}){
    this.stop();this.lastError='';const account=accountId?this.record.accounts.find(a=>a.clientId===accountId):null;
    if(accountId&&!account)throw failure('保存済みアカウントが見つかりません');
    const pending={state:random(),nonce:random(),verifier:random(),account,used:false};
    const server=pending.server=http.createServer(async(req,res)=>{
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
      try{
        const url=new URL(req.url,pending.redirect);
        if(req.method!=='GET'||url.pathname!=='/auth/callback'||this.pending!==pending||pending.used||url.searchParams.get('state')!==pending.state){res.statusCode=400;res.end('接続の確認ができません。REIからやり直してください。');return;}
        pending.used=true;
        if(url.searchParams.has('error'))throw failure('ChatGPTへの接続が許可されませんでした');
        const clientId=url.searchParams.get('client_id')||account?.clientId;
        if(!clientId||clientId==='dynamic_agent_client'||(account&&clientId!==account.clientId))throw failure('ChatGPTの接続登録を確認できませんでした');
        const code=url.searchParams.get('code');if(!code||code.length>4000)throw failure('ログインの確認コードが無効です');
        const tokens=await this.json(`${issuer}/api/accounts/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,code_verifier:pending.verifier,redirect_uri:pending.redirect,resource})});
        const {keys}=await this.json(`${issuer}/.well-known/jwks.json`);
        const claims=validateIdToken(tokens.id_token,keys,{clientId,nonce:pending.nonce,subject:account?.subject});
        const granted=String(tokens.scope||'').split(/\s+/);if(!granted.includes('chatgpt.tokens.use.direct')||!granted.includes('resource.invoke')||!tokens.access_token||!tokens.refresh_token)throw failure('ChatGPTの利用枠を使う権限がありません。ログイン時の許可を確認してください');
        const next={clientId,subject:claims.sub,email:claims.email||'',idToken:tokens.id_token,accessToken:tokens.access_token,refreshToken:tokens.refresh_token,scopes:granted,expiresAt:Date.now()+Number(tokens.expires_in||3600)*1000,models:[],model:null};
        const existing=this.record.accounts.findIndex(a=>a.clientId===clientId);
        if(existing>=0&&this.record.accounts[existing].subject!==next.subject)throw failure('別のアカウントの登録と一致しません');
        if(existing>=0)this.record.accounts[existing]=next;else this.record.accounts.push(next);
        this.record.active=clientId;this.save();
        try{await this.models();}catch{this.lastError='ログインしました。モデルの取得はREIから再試行してください';}
        res.end('REIへのChatGPT接続が完了しました。REIの設定画面で「接続状態を更新」を押してください。');
      }catch(error){this.lastError=error.message;res.statusCode=400;res.end(error.message);}
      finally{if(pending.used)this.stop();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    pending.redirect=`http://127.0.0.1:${server.address().port}/auth/callback`;this.pending=pending;pending.timer=setTimeout(()=>this.stop(),300000);pending.timer.unref();
    const url=new URL(`${issuer}/api/accounts/authorize`);
    const params={client_id:account?.clientId||'dynamic_agent_client',ext_agent_host_id:this.record.hostId,response_type:'code',redirect_uri:pending.redirect,scope:scopes,resource,state:pending.state,nonce:pending.nonce,code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(pending.verifier).digest('base64url')};
    if(account){if(account.idToken)params.id_token_hint=account.idToken;if(account.email)params.login_hint=account.email;}else params.agent_name_hint='REI';
    for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);return {url:url.href};
  }
  async token(){
    const account=this.account();if(!account?.accessToken)throw failure('REIの設定からChatGPTを接続してください');
    if(account.expiresAt>Date.now()+60000)return account.accessToken;
    if(this.refreshing)return this.refreshing;
    this.refreshing=(async()=>{
      const tokens=await this.json(`${issuer}/api/accounts/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:account.clientId,refresh_token:account.refreshToken,resource})});
      if(this.account()!==account)throw failure('接続アカウントが変わりました。もう一度質問してください');
      const granted=tokens.scope?tokens.scope.split(/\s+/):account.scopes;
      if(!tokens.access_token||!granted.includes('chatgpt.tokens.use.direct')||!granted.includes('resource.invoke'))throw failure('ChatGPTの再接続が必要です');
      Object.assign(account,{accessToken:tokens.access_token,refreshToken:tokens.refresh_token||account.refreshToken,expiresAt:Date.now()+Number(tokens.expires_in||3600)*1000,scopes:granted});this.save();return account.accessToken;
    })().finally(()=>{this.refreshing=null;});return this.refreshing;
  }
  async models(){
    const account=this.account(),token=await this.token();const data=await this.json(`${resource}/models`,{headers:{authorization:`Bearer ${token}`}});
    if(this.account()!==account)throw failure('接続アカウントが変わりました');
    account.models=(data.models||[]).filter(m=>m.visibility==='list'&&typeof m.slug==='string').map(m=>({id:m.slug,name:m.display_name||m.slug}));
    if(!account.models.length)throw failure('利用できるChatGPTモデルが見つかりません');
    if(!account.models.some(m=>m.id===account.model))account.model=account.models[0].id;this.save();return this.status();
  }
  select({accountId,model}){
    if(accountId){if(!this.record.accounts.some(a=>a.clientId===accountId&&a.accessToken))throw failure('ChatGPTを再接続してください');this.record.active=accountId;}
    if(model){const account=this.account();if(!account?.models.some(m=>m.id===model))throw failure('利用できるモデルを選んでください');account.model=model;}
    this.save();return this.status();
  }
  async disconnect(){
    this.stop();const account=this.account();let revoked=true;
    if(account?.refreshToken)try{
      const config=await this.json(`${issuer}/.well-known/openid-configuration`);const url=new URL(config.revocation_endpoint);if(url.origin!==issuer)throw 0;
      const result=await this.fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:account.refreshToken,token_type_hint:'refresh_token',client_id:account.clientId})});revoked=result.ok;
    }catch{revoked=false;}
    if(account){delete account.accessToken;delete account.refreshToken;delete account.idToken;account.models=[];account.model=null;}this.record.active=null;this.save();return {ok:true,revoked};
  }
  async generate(messages,{signal,effort,onDelta}={}){
    const account=this.account();if(!account?.model)throw failure('ChatGPTの接続状態を更新してモデルを選んでください');
    const started=performance.now();const token=await this.token(),tokenMs=Math.round(performance.now()-started),instructions=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),input=messages.filter(m=>m.role!=='system').map(m=>({role:m.role,content:m.content}));
    const response=await this.fetcher(`${resource}/responses`,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({model:account.model,instructions:instructions+'\nAPIの出力形式のdecisionフィールドへ判断JSONを入れて返す。',input,store:false,stream:true,text:{format:decisionFormat},reasoning:{effort:effort==='low'?'low':account.model==='gpt-6-sol'?'none':'low'}}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)});
    if(!response.ok)throw failure(response.status===429?'ChatGPTの利用枠に達しました。利用状況を確認してください':'ChatGPTが返答できませんでした。接続とモデルを確認してください');const headersMs=Math.round(performance.now()-started);const result=await readResponseStream(response,{onDelta});return {...result,timing:{tokenMs,headersMs,...result.timing,totalMs:Math.round(performance.now()-started)}};
  }
}
