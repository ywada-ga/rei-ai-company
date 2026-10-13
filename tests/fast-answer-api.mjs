import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FastAnswerApi,generateFirstAnswer} from '../fast-answer-api.mjs';
import {runProvisionalConversation} from '../conversation-provisional.mjs';
import {prefetchScopeKey} from '../conversation-prefetch.mjs';

const root=mkdtempSync(path.join(os.tmpdir(),'rei-fast-answer-'));
const token='sk-fixture-not-a-real-key-1234567890',messages=[{role:'system',content:'Return JSON'},{role:'user',content:'Synthetic evidence only'}];
const options={phase:'provisional_answer'};
const config={apiKey:token,model:'gpt-4o-mini',maxRequests:1,enabled:true,paidConsent:true};
let calls=0,fallbacks=0;
const text=JSON.stringify({decision:{action:'respond',status:'supported',sourceIds:['synthetic'],reason:'',query:'',text:'架空の要点です。'}});
const success=async(url,request)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(request.headers.authorization,`Bearer ${token}`);assert.equal(request.redirect,'error');
  const body=JSON.parse(request.body);assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.max_output_tokens,800);assert.equal(body.text.format.name,'rei_provisional');assert.ok(!('tools' in body));assert.equal(body.model,'gpt-4o-mini');
  return new Response(`data: ${JSON.stringify({type:'response.output_text.delta',delta:text})}\n\ndata: ${JSON.stringify({type:'response.completed'})}\n\n`);
};
const fallback={generate:async()=>{fallbacks++;return {text:'Pro response'};}};
try{
  const api=new FastAnswerApi(path.join(root,'alice'),{fetcher:success});
  assert.equal(api.status().enabled,false);
  await generateFirstAnswer(api,fallback,messages,options);assert.equal(calls,0);assert.equal(fallbacks,1);
  assert.throws(()=>api.configure({...config,paidConsent:false}));assert.throws(()=>api.configure({...config,maxRequests:11}));assert.throws(()=>api.configure({...config,model:'bad\nheader'}));
  api.configure(config);
  assert.ok(!readFileSync(api.file,'utf8').includes(token));assert.ok(!JSON.stringify(api.status()).includes(token));
  if(process.platform!=='win32'){assert.equal(statSync(api.file).mode&0o777,0o600);assert.equal(statSync(api.keyFile).mode&0o777,0o600);}
  await generateFirstAnswer(api,fallback,messages,{phase:'evidence_answer'});assert.equal(calls,0);assert.equal(fallbacks,2);
  await assert.rejects(api.generate(messages,{phase:'verification_supplement'}));assert.equal(api.status().attempts,0);
  const canceled=new AbortController();canceled.abort();await assert.rejects(api.generate(messages,{...options,signal:canceled.signal}));assert.equal(api.status().attempts,0);
  await assert.rejects(api.generate([{role:'user',content:'x'.repeat(33000)}],options));assert.equal(api.status().attempts,0);
  let delta;const result=await generateFirstAnswer(api,fallback,messages,{...options,onDelta:raw=>delta=raw});assert.equal(result.text,text);assert.equal(delta,text);assert.equal(calls,1);assert.equal(api.status().remaining,0);assert.ok(Number.isFinite(result.timing.headersMs));
  await generateFirstAnswer(api,fallback,messages,options);assert.equal(calls,1);assert.equal(fallbacks,3);
  const reloaded=new FastAnswerApi(api.directory,{fetcher:success});assert.equal(reloaded.status().attempts,1);await assert.rejects(reloaded.generate(messages,options));
  assert.equal(new FastAnswerApi(path.join(root,'bob'),{fetcher:success}).status().configured,false);
  api.removeKey();assert.equal(api.status().configured,false);assert.equal(api.status().enabled,false);assert.equal(api.status().attempts,1);

  let failures=0;const broken=new FastAnswerApi(path.join(root,'broken'),{fetcher:async()=>{failures++;throw Error(token+' private provider text');}});broken.configure(config);
  await assert.rejects(generateFirstAnswer(broken,fallback,messages,options),error=>!error.message.includes(token));assert.equal(failures,1);assert.equal(broken.status().remaining,0);assert.equal(fallbacks,3);

  // A transport ignoring abort must not publish a late delta/completion.
  let release;const late=new FastAnswerApi(path.join(root,'late'),{fetcher:()=>new Promise(resolve=>release=()=>resolve(success('https://api.openai.com/v1/responses',{headers:{authorization:`Bearer ${token}`},redirect:'error',body:JSON.stringify({store:false,stream:true,max_output_tokens:800,text:{format:{name:'rei_provisional'}},model:'gpt-4o-mini'})})))});late.configure(config);
  const abort=new AbortController();let lateDelta=0;const pending=late.generate(messages,{...options,signal:abort.signal,onDelta:()=>lateDelta++});abort.abort();release();await assert.rejects(pending);assert.equal(lateDelta,0);assert.equal(late.status().attempts,1);
  const at=Date.now(),scope={userId:'fixture',role:'owner',integration:'fixture',groups:[{id:'fixture-group',personal:false}]};
  const episode={uuid:'synthetic',group_id:'fixture-group',name:'架空会社',content:'架空会社の要点は架空の情報です。',origin:'manual',source_ref:'fixture',recorded_at:new Date(at).toISOString()};
  const snapshot={version:1,scopeKey:'conversation-prefetch:'+prefetchScopeKey(scope),checkedAt:at,bodyCoverage:'limited',records:[{episode,addedAt:new Date(at).toISOString(),fetchedAt:at}]};
  const fresh={answer:'架空の要点です。',spokenAnswer:'架空の要点です。',synapseRead:true,evidenceStatus:'supported',sources:[{uuid:episode.uuid}],evidence:[{tool:'get_episode',uuid:episode.uuid,result:{structuredContent:{episode,coverage:{complete:true}}}}]};
  const integrated=new FastAnswerApi(path.join(root,'integrated'),{fetcher:success});integrated.configure({...config,maxRequests:2});
  let finish;const latest=new Promise(resolve=>finish=resolve),events=[];
  const pendingConversation=runProvisionalConversation({question:'架空会社について教えて',scope,getSnapshot:async()=>snapshot,authorize:async()=>true,generate:(m,o)=>generateFirstAnswer(integrated,fallback,m,o),verify:()=>latest,onEvent:event=>events.push(event)});
  await new Promise(resolve=>setImmediate(resolve));assert.ok(events.some(e=>e.type==='provisional'&&e.verification==='pending'));
  finish(fresh);assert.equal((await pendingConversation).provisionalUsed,true);assert.ok(events.some(e=>e.type==='verified'));assert.equal(integrated.status().attempts,1);
  let settleFresh;const freshLater=new Promise(resolve=>settleFresh=resolve);
  const expired=runProvisionalConversation({question:'架空会社について教えて',scope,getSnapshot:async()=>({...snapshot,checkedAt:at-700000}),authorize:async()=>true,generate:(m,o)=>generateFirstAnswer(integrated,fallback,m,o),verify:()=>freshLater,onEvent:()=>{}});
  await new Promise(resolve=>setImmediate(resolve));settleFresh(fresh);assert.equal((await expired).provisionalUsed,false);assert.equal(integrated.status().attempts,1,'Expired evidence must not reach the paid transport');
  console.log('PASS fast answer API: phase isolation, encrypted user keys, durable attempt cap, no retries, cancellation, redaction and provisional/fresh evidence integration');
}finally{rmSync(root,{recursive:true,force:true});}
