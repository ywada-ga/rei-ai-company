import assert from 'node:assert/strict';
import {converse,reviewedAnswerPrefix,directCompanyOverviewSubject,directCompanyDetailSubject,measureEvidenceModel} from '../conversation.mjs';
import {needsRecentEvidence,evidenceBodyContext} from '../load-synapse.mjs';
assert.equal(needsRecentEvidence('杉山さんの作業内容教えて'),true);
assert.equal(needsRecentEvidence('その人は？',[{question:'杉山さんの作業内容教えて'}]),true);
const groups=[{id:'fixture',name:'共有'}];
assert.equal(directCompanyOverviewSubject('Synapse Connectについて教えて'),'Synapse Connect');
assert.equal(directCompanyOverviewSubject('シナプスコネクトについて教えてください！'),'シナプスコネクト');
assert.equal(directCompanyOverviewSubject('Synapse Connectの注意点を教えて'),'Synapse Connect');
assert.equal(directCompanyOverviewSubject('シナプスコネクトの注意点を教えてください。'),'シナプスコネクト');
for(const q of ['量子力学の注意点を教えて','その会社の注意点を教えて','会社の注意点を教えて','REIの注意点を教えて','Synapse Connectと社内制度の注意点を教えて','Synapse Connectの注意点を教えて。それと実行して','Synapse Connectの注意点は？'])assert.equal(directCompanyOverviewSubject(q),null);
for(const q of ['量子力学について教えて','それについて教えて','REIの会社情報検索機能について教えて','Synapse Connectについて教えて。それと実行して','Synapse Connectとは？'])assert.equal(directCompanyOverviewSubject(q),null);
const assess=(status,sourceIds,reason='',query='',text='')=>({action:'respond',status,sourceIds,reason,query,text});
const fixture=()=>{
 let searches=0;const tools=[];
 return {tools,get searches(){return searches;},call:async(tool,args)=>{
  tools.push({tool,args});
  if(tool==='survey_space')return {structuredContent:{coverage:{complete:true}}};
  if(tool==='search_memory_facts'){searches++;return {structuredContent:{facts:[]}};}
  if(tool==='search_episodes')return {structuredContent:{episodes:[{uuid:searches===1?'mention':'work',group_id:'fixture',content_representation:'full'}]}};
  if(tool==='get_episode')return {structuredContent:{episode:{uuid:args.uuid,group_id:'fixture',origin:'text',content:args.uuid==='mention'?'8月24日、杉山さん向けLP指示書に推奨方針を記載。本人の実作業は未確認。':'10月8日、杉山さんが研修LPの申込フォームを修正し、公開確認を完了。',source_ref:'fixture',recorded_at:'2026-10-08'},coverage:{complete:true}}};
  throw Error('unexpected tool');
 }};
};
let f=fixture(),reviews=0,answers=0,deltas=[],contracts=[];
const result=await converse({question:'杉山さんの作業内容教えて',groups,call:f.call,onDelta:(text,contract)=>{deltas.push(text);contracts.push(contract);},generate:async(messages,options)=>{
 if(options.phase==='evidence_answer'){
  reviews++;
  const decision=reviews===1?assess('insufficient',[],'指示書だけでは実際の作業を確認できません。','杉山'):assess('supported',['work'],'','','10月8日の記録では、申込フォームを修正し公開確認を完了しています。');
  if(reviews===2)answers++;const text=JSON.stringify(decision);options.onDelta?.(text);return {text};
 }
 if(!f.searches)return {text:JSON.stringify({action:'search',query:'杉山 LP'})};
 answers++;assert.equal(f.searches,2);assert.equal(reviews,2);
 const text=JSON.stringify({action:'answer',text:'10月8日の記録では、申込フォームを修正し公開確認を完了しています。'});options.onDelta?.(text);return {text};
}});
assert.equal(answers,1);assert.equal(result.evidenceStatus,'supported');assert.deepEqual(result.sources.map(source=>source.uuid),['work']);assert.ok(!result.answer.includes('mention'));assert.match(deltas.join(''),/10月8日/);
assert.equal(f.tools.filter(t=>t.tool==='search_episodes').length,4);
// Unrelated complete bodies do not authorize a final answer or leak a draft delta.
f=fixture();reviews=0;deltas=[];
const insufficient=await converse({question:'杉山さんの作業内容教えて',groups,call:f.call,onDelta:x=>deltas.push(x),generate:async(messages,options)=>({text:JSON.stringify(options.phase==='evidence_answer'?(reviews++,assess('insufficient',[],'今回の記録は指示で、実施内容を確認できません。','杉山')):{action:'search',query:'杉山'})})});
assert.equal(reviews,2);assert.equal(insufficient.evidenceStatus,'insufficient');assert.deepEqual(deltas,[]);assert.deepEqual(insufficient.sources,[]);
// A fabricated citation must fail closed even when the reviewer calls it supported.
f=fixture();await assert.rejects(converse({question:'杉山さんの作業内容教えて',groups,call:f.call,generate:async(messages,options)=>({text:JSON.stringify(options.phase==='evidence_answer'?assess('supported',['invented'],'','','捏造した回答'):{action:'search',query:'杉山'})})}),/根拠の評価/);
console.log('PASS implicit current-work retrieval, relevance review, retry before streaming, insufficient evidence and fabricated citation rejection');
assert.ok(contracts.length&&contracts.every(c=>c?.synapseRead===true&&c.evidenceStatus==='supported'));
assert.ok(contracts.every(c=>c.sources.some(s=>s.uuid==='work')&&c.evidence.some(e=>e.tool==='get_episode'&&e.uuid==='work'&&e.result.structuredContent.coverage.complete===true)));
assert.ok(!JSON.stringify(deltas).includes('structuredContent'),'Internal bodies never enter public text deltas');
console.log('PASS fresh answer deltas carry an internal full-evidence assessment after retry, separate from public text');

f=fixture();const abort=new AbortController();let emittedAfterAbort=false;
await assert.rejects(converse({question:'杉山さんの作業内容教えて',groups,signal:abort.signal,call:f.call,onDelta:()=>{emittedAfterAbort=true;},generate:async(messages,options)=>{
 if(options.phase==='evidence_answer'){abort.abort();return {text:JSON.stringify(assess('supported',['mention'],'','','本文'))};}
 return {text:JSON.stringify({action:'search',query:'杉山'})};
}}),/中断/);assert.equal(emittedAfterAbort,false);
console.log('PASS cancellation during evidence review prevents final answer and streaming');
// Provisional wording reaches only the fresh-body reviewer; it cannot replace
// retrieval, expand citations, or prevent correction of outdated claims.
for(const oldId of ['work','unread']){
 f=fixture();let readAt=0,sawComparison=false;
 const corrected=await converse({question:'杉山さんの作業内容教えて',groups,call:f.call,getProvisionalAnswer:()=>{readAt++;assert.ok(f.tools.some(t=>t.tool==='get_episode'));return {text:'杉山さんはまだ修正していません。',sourceIds:[oldId]};},generate:async(messages,options)=>{
  if(options.phase!=='evidence_answer')return {text:JSON.stringify({action:'search',query:'杉山'})};
  const comparison=messages.find(m=>m.content.includes('provisionalComparison'));
  if(comparison){sawComparison=true;assert.equal(JSON.parse(comparison.content).provisionalComparison.text,'杉山さんはまだ修正していません。');assert.ok(messages.some(m=>m.content.includes('先頭一致より回答の正確さ')));}
  return {text:JSON.stringify(f.searches===1?assess('insufficient',[],'実作業を調べる','杉山'):assess('supported',['work'],'','','10月8日に修正と公開確認を完了しています。'))};
 }});
 assert.ok(readAt>=2);assert.equal(sawComparison,oldId==='work');assert.match(corrected.answer,/完了しています/);assert.ok(!corrected.answer.includes('まだ修正'));
 assert.equal(f.tools.filter(t=>t.tool==='get_episode').length,2,'Fresh bodies still read on each round');
}
console.log('PASS provisional comparison only after fresh retrieval, unknown IDs excluded, outdated claims corrected');

const longLog='古い方針\n'+'x'.repeat(20000)+'\n2026-10-08 杉山さんが申込フォームの修正を完了。';
const excerpt=evidenceBodyContext(longLog,'杉山さんの作業内容教えて',{recent:true});
assert.equal(excerpt.omitted,true);
assert.equal(excerpt.originalChars,longLog.length);
assert.ok(excerpt.excerpts.some(e=>e.text.includes('2026-10-08 杉山さん')),'latest work at the end must reach the answer model');
assert.ok(excerpt.excerpts.reduce((n,e)=>n+e.text.length,0)<=6000);
for(const e of excerpt.excerpts)assert.equal(e.text,longLog.slice(e.start,e.end));
assert.equal(evidenceBodyContext('短い本文','本文'),'短い本文');

assert.ok(f.tools.some(t=>t.tool==='search_episodes'&&t.args.query==='work_log'&&t.args.limit===50));
for(const t of f.tools)assert.deepEqual(t.args.group_ids,['fixture']);
console.log('PASS work-log candidates use existing scope; excerpts retain the end of long logs');

const smallExcerpt=evidenceBodyContext(longLog,'杉山さん',{recent:true,budget:600});
assert.ok(smallExcerpt.excerpts.reduce((n,e)=>n+e.text.length,0)<=600);

const ids=new Set(['work']);
const valid=JSON.stringify(assess('supported',['work'],'','','検証済みの回答です。'));
for(let i=1;i<=valid.length;i++){const p=reviewedAnswerPrefix(valid.slice(0,i),ids);assert.ok('検証済みの回答です。'.startsWith(p));}
assert.equal(reviewedAnswerPrefix(valid,ids),'検証済みの回答です。');
assert.equal(reviewedAnswerPrefix(JSON.stringify(assess('supported',['invented'],'','','漏らさない')),ids),'');
assert.equal(reviewedAnswerPrefix(JSON.stringify(assess('insufficient',[],'不足','','漏らさない')),ids),'');
assert.equal(reviewedAnswerPrefix(JSON.stringify(assess('partial',['work'],'','再検索','漏らさない')),ids),'');
console.log('PASS a single answer generation releases only text after validated assessment fields');
// Cache only scoped structural metadata; each follow-up still searches and reads anew.
f=fixture();const outlineCache={};
const common={outlineCache,groups,call:f.call,reviewEvidence:async({verifiedIds})=>({status:'supported',sourceIds:verifiedIds,reason:'',query:''}),generate:async messages=>({text:JSON.stringify(messages.some(m=>m.role==='user'&&m.content?.startsWith('保存本文確認=成功'))?{action:'answer',text:'取得した本文の説明です。'}:{action:'search',query:'テスト'})})};
await converse({...common,question:'テストグループについて教えて'});
await converse({...common,question:'もっと詳しく',context:[{question:'テストグループについて教えて',synapseRead:true}]});
assert.equal(f.tools.filter(t=>t.tool==='survey_space').length,1);
assert.equal(f.tools.filter(t=>t.tool==='search_memory_facts').length,2);
assert.equal(f.tools.filter(t=>t.tool==='get_episode').length,2);
await converse({...common,question:'別会社について教えて',context:[{question:'テストグループについて教えて',synapseRead:true}]});
assert.equal(f.tools.filter(t=>t.tool==='survey_space').length,2);
outlineCache.at-=90001;
await converse({...common,question:'もっと詳しく',context:[{question:'別会社について教えて',synapseRead:true}]});
assert.equal(f.tools.filter(t=>t.tool==='survey_space').length,3);
await converse({...common,groups:[{id:'other',name:'別範囲'}],question:'もっと詳しく',context:[{question:'別会社について教えて',synapseRead:true}],call:async(tool,args)=>{if(tool==='survey_space')return {structuredContent:{coverage:{reasons:['group_unavailable']}}};throw Error('must not read inaccessible group');}});
console.log('PASS outline reuse keeps fresh body reads, changes topic/scope and expires after 90 seconds');
f=fixture();const preflight={scope:JSON.stringify(groups),at:Date.now(),preflight:true,pending:Promise.resolve(),result:{structuredContent:{coverage:{complete:true}}}};
let answerGenerations=0;
const preflightAnswer=await converse({question:'テストグループについて教えて',groups,outlineCache:preflight,signal:new AbortController().signal,call:f.call,generate:async(messages,options)=>{
 assert.equal(options.phase,'evidence_answer');answerGenerations++;
 return {text:JSON.stringify(assess('supported',['mention'],'','','保存本文からの回答です。'))};
}});
assert.equal(answerGenerations,1);
assert.equal(f.tools.filter(t=>t.tool==='survey_space').length,0);
assert.equal(f.tools.filter(t=>t.tool==='get_episode').length,1);
assert.equal(preflightAnswer.outlineReused,true);
assert.equal(preflightAnswer.readingSkill.name,'load-synapse');
assert.equal(preflight.preflight,false);
console.log('PASS preflight consumes only structural metadata and answers in one model call after fresh body read');
// A canceled caller must leave a shared preparation available to other callers.
let releaseOutline;
const pendingOutline=new Promise(resolve=>{releaseOutline=resolve;});
const abortOutline=new AbortController();let canceledOutlineCalls=0;
const pendingCache={scope:JSON.stringify(groups),pending:pendingOutline};
const canceledConversation=converse({question:'テストグループについて教えて',groups,outlineCache:pendingCache,signal:abortOutline.signal,
 call:async()=>{canceledOutlineCalls++;throw Error('Canceled conversation must not fetch');},
 generate:async()=>{canceledOutlineCalls++;throw Error('Canceled conversation must not generate');}
});
abortOutline.abort();
let abortDeadline;
try{
 await assert.rejects(Promise.race([canceledConversation,new Promise((_,reject)=>{abortDeadline=setTimeout(()=>reject(Error('Shared preparation blocked cancellation')),200);})]),/会話を中断しました/);
 assert.equal(pendingCache.pending,pendingOutline);
 assert.equal(canceledOutlineCalls,0);
}finally{clearTimeout(abortDeadline);releaseOutline();}
await assert.rejects(canceledConversation,/会話を中断しました/);
assert.equal(canceledOutlineCalls,0);
console.log('PASS interruption stops waiting for shared outline preparation without canceling it or starting late reads');
for(const [question,subject] of [['Synapse Connectについて教えて','Synapse Connect'],['社内制度について教えてください','社内制度'],['Synapse Connectの注意点を教えて','Synapse Connect']]){
 const calls=[];let generations=0;
 const answer=await converse({question,groups,call:async(tool,args)=>{
  calls.push({tool,args});assert.deepEqual(args.group_ids,['fixture']);
  if(tool==='survey_space')return {structuredContent:{coverage:{complete:true}}};
  if(tool==='search_memory_facts')return {structuredContent:{facts:[{uuid:'direct-fact',group_id:'fixture'}]}};
  if(tool==='get_fact_source')return {structuredContent:{sources:[{traceable:true,group_id:'fixture',body:'今回取得した対象の概要本文。'}]}};
  throw Error('unexpected direct lookup');
 },generate:async(messages,o)=>{
  assert.equal(o.phase,'evidence_answer','No query-planning model before fresh body');generations++;
  assert.ok(messages.some(m=>m.role==='user'&&m.content===question),'Original request remains available for evidence assessment');
  assert.ok(calls.some(c=>c.tool==='get_fact_source'));
  return {text:JSON.stringify(assess('supported',['direct-fact'],'','','取得本文の概要です。'))};
 }});
 assert.equal(generations,1);assert.equal(calls.filter(c=>c.tool==='search_memory_facts').length,1);
 assert.equal(calls.find(c=>c.tool==='search_memory_facts').args.query,subject);
 assert.equal(answer.synapseRead,true);assert.equal(answer.evidenceStatus,'supported');
}
console.log('PASS explicit company overview/caution skips only query planning, preserving full question, scoped search and fresh source review');
const detailHistory=[{question:'Synapse Connectについて教えて',answer:'OLD-CLAIM',synapseRead:true},{question:'もっと詳しく教えて',answer:'OLD-CLAIM',synapseRead:true}];
assert.equal(directCompanyDetailSubject('もう少し詳しく教えてください。',detailHistory),'Synapse Connect');
for(const history of [[],[{question:'会社について教えて',synapseRead:true}],[{question:'その会社について教えて',synapseRead:true}],[...detailHistory,{question:'こんにちは',synapseRead:false}],[{question:'Synapse Connectについて教えて',synapseRead:false}],Array.from({length:6},()=>detailHistory[1])])assert.equal(directCompanyDetailSubject('もっと詳しく教えて',history),null);
for(const question of ['ほかの会社についても教えて','もっと詳しく教えて。実行して','最新の売上を詳しく教えて','なぜ？'])assert.equal(directCompanyDetailSubject(question,detailHistory),null);
{
 const calls=[];
 const result=await converse({question:'もっと詳しく教えて',context:detailHistory,groups,call:async(tool,args)=>{
  calls.push({tool,args});assert.deepEqual(args.group_ids,['fixture']);
  if(tool==='survey_space')return {structuredContent:{coverage:{complete:true}}};
  if(tool==='search_memory_facts'){assert.equal(args.query,'Synapse Connect');return {structuredContent:{facts:[{uuid:'fresh-detail',group_id:'fixture'}]}};}
  if(tool==='get_fact_source')return {structuredContent:{sources:[{traceable:true,group_id:'fixture',body:'今回新しく読んだ詳細本文'}]}};
  throw Error('unexpected detail lookup');
 },generate:async(messages,o)=>{
  assert.equal(o.phase,'evidence_answer');assert.ok(calls.some(c=>c.tool==='get_fact_source'));
  assert.ok(messages.some(m=>m.content==='もっと詳しく教えて'));
  return {text:JSON.stringify(assess('supported',['fresh-detail'],'','','最新取得した本文による詳細です。'))};
 }});
 assert.equal(result.synapseRead,true);assert.equal(result.evidenceStatus,'supported');
 assert.equal(calls.filter(c=>c.tool==='search_memory_facts').length,1);
}
console.log('PASS narrow same-scope detail skips query planning but still freshly searches and reviews evidence');
for(const resolved of [true,false]){
 const history=[{question:'Synapse Connectについて教えて',answer:'OLD-DETAIL-CLAIM'.repeat(300),synapseRead:true},{question:'要点を先に説明して',answer:'PREFERENCE-ANSWER',synapseRead:true},{question:resolved?'Synapse Connectについて教えて':'別の会社についても教えて',answer:'LATEST-CONTINUITY-ANSWER',synapseRead:true}];
 let evaluated=false;
 const result=await converse({question:'もっと詳しく教えて',context:history,groups,call:async tool=>{
  if(tool==='survey_space')return {structuredContent:{coverage:{complete:true}}};
  if(tool==='search_memory_facts')return {structuredContent:{facts:[{uuid:'detail-body',group_id:'fixture'}]}};
  if(tool==='get_fact_source')return {structuredContent:{sources:[{traceable:true,group_id:'fixture',body:'FRESH-DETAIL-BODY'}]}};
  throw Error('unexpected detail lookup');
 },generate:async(messages,o)=>{
  assert.ok(history.every(t=>messages.some(m=>m.role==='user'&&m.content===t.question)));
  const prior=messages.filter(m=>m.role==='assistant'&&history.some(t=>t.answer===m.content));
  assert.equal(prior.length,resolved?1:3);
  assert.equal(prior.at(-1).content,'LATEST-CONTINUITY-ANSWER');
  assert.equal(prior.some(m=>m.content.includes('OLD-DETAIL-CLAIM')),!resolved);
  if(o.phase!=='evidence_answer')return {text:JSON.stringify({action:'search',query:'会社'})};
  assert.ok(messages.some(m=>m.content.includes('FRESH-DETAIL-BODY')));evaluated=true;
  return {text:JSON.stringify(assess('supported',['detail-body'],'','','今回の本文を確認した詳細です。'))};
 }});
 assert.ok(evaluated);assert.equal(result.evidenceStatus,'supported');
}
console.log('PASS resolved detail keeps user preferences and latest answer, omits older AI claims only after topic resolution');
assert.equal(reviewedAnswerPrefix(JSON.stringify(assess('partial',['work'],'','','未確定の部分回答')),ids),'');
assert.equal(reviewedAnswerPrefix(JSON.stringify(assess('partial',['work'],'','','確認できた部分回答')),ids,{canRetry:false}),'確認できた部分回答');
console.log('PASS a partial draft cannot leak before a possible retry');

// Preserve provider results and streaming; expose no prompt, IDs or unknown timing fields.
const modelChecks=[],seenDeltas=[],privateInput=[{role:'user',content:'PRIVATE-BODY 秘密'}];let clock=100;
const providerResult={text:'PRIVATE-RESULT',timing:{tokenMs:0,headersMs:12,streamFirstDeltaMs:4,streamCompleteMs:NaN,totalMs:-1,credential:'PRIVATE-TOKEN'}};
const measured=measureEvidenceModel(async(messages,o)=>{assert.equal(messages,privateInput);clock=112;o.onDelta?.('{');clock=120;return providerResult;},modelChecks,()=>clock);
assert.equal(await measured(privateInput,{phase:'evidence_answer',onDelta:d=>seenDeltas.push(d)}),providerResult);
assert.deepEqual(seenDeltas,['{']);assert.deepEqual(modelChecks,[{inputBytes:Buffer.byteLength(JSON.stringify(privateInput)),modelMs:20,firstDeltaMs:12,transport:{tokenMs:0,headersMs:12,streamFirstDeltaMs:4}}]);
assert.ok(!JSON.stringify(modelChecks).includes('PRIVATE'));
await measured(privateInput,{phase:'provisional_answer'});assert.equal(modelChecks.length,1);
await measured(privateInput,{phase:'evidence_answer'});assert.equal(modelChecks[1].firstDeltaMs,null);
const failedChecks=[];await assert.rejects(measureEvidenceModel(async()=>{throw Error('provider unavailable');},failedChecks)(privateInput,{phase:'evidence_answer'}),/provider unavailable/);assert.equal(failedChecks.length,0);
console.log('PASS latest evidence model diagnostics preserve stream and omit private data/invalid timing');

for(const question of ['Synapse Connectについて教えて','もっと詳しく','その会社について教えて','会社について教えて','私の会社について教えて']){
 let sawModel=false;
 const old='OLD-UNVERIFIED-AI-CLAIM'.repeat(80),userPreference='要点を先に説明して';
 const response=await converse({question,groups,context:[{question:userPreference,answer:old,synapseRead:true}],call:async tool=>{
  if(tool==='survey_space')return {structuredContent:{coverage:{complete:true}}};
  if(tool==='search_memory_facts')return {structuredContent:{facts:[{uuid:'fresh-overview',group_id:'fixture'}]}};
  if(tool==='get_fact_source')return {structuredContent:{sources:[{traceable:true,group_id:'fixture',body:'FRESH-BODY'}]}};
  throw Error('unexpected tool');
 },generate:async(messages,o)=>{
  sawModel=true;assert.ok(messages.some(m=>m.role==='user'&&m.content===userPreference));
  assert.equal(messages.some(m=>m.role==='assistant'&&m.content===old),question!=='Synapse Connectについて教えて');
  if(o.phase!=='evidence_answer')return {text:JSON.stringify({action:'search',query:'会社'})};
  assert.ok(messages.some(m=>m.content.includes('FRESH-BODY')));
  return {text:JSON.stringify(assess('supported',['fresh-overview'],'','','今回取得した本文に基づく概要です。'))};
 }});
 assert.ok(sawModel);assert.equal(response.synapseRead,true);assert.equal(response.evidenceStatus,'supported');
}
console.log('PASS named overview omits old AI claims; user preferences and follow-up history remain with fresh source review');
