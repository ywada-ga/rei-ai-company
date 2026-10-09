import assert from 'node:assert/strict';
import {converse,reviewedAnswerPrefix} from '../conversation.mjs';
import {needsRecentEvidence,evidenceBodyContext} from '../load-synapse.mjs';
assert.equal(needsRecentEvidence('杉山さんの作業内容教えて'),true);
assert.equal(needsRecentEvidence('その人は？',[{question:'杉山さんの作業内容教えて'}]),true);
const groups=[{id:'fixture',name:'共有'}];
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
let f=fixture(),reviews=0,answers=0,deltas=[];
const result=await converse({question:'杉山さんの作業内容教えて',groups,call:f.call,onDelta:text=>deltas.push(text),generate:async(messages,options)=>{
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
f=fixture();const preflight={scope:JSON.stringify(groups),at:Date.now(),preflight:true,result:{structuredContent:{coverage:{complete:true}}}};
let answerGenerations=0;
const preflightAnswer=await converse({question:'テストグループについて教えて',groups,outlineCache:preflight,call:f.call,generate:async(messages,options)=>{
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
assert.equal(reviewedAnswerPrefix(JSON.stringify(assess('partial',['work'],'','','未確定の部分回答')),ids),'');
assert.equal(reviewedAnswerPrefix(JSON.stringify(assess('partial',['work'],'','','確認できた部分回答')),ids,{canRetry:false}),'確認できた部分回答');
console.log('PASS a partial draft cannot leak before a possible retry');
