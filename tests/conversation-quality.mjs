import assert from 'node:assert/strict';
import {converse} from '../conversation.mjs';
import {needsRecentEvidence,evidenceBodyContext} from '../load-synapse.mjs';
assert.equal(needsRecentEvidence('杉山さんの作業内容教えて'),true);
assert.equal(needsRecentEvidence('その人は？',[{question:'杉山さんの作業内容教えて'}]),true);
const groups=[{id:'fixture',name:'共有'}];
const assess=(status,sourceIds,reason='',query='')=>({action:'assess',status,sourceIds,reason,query});
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
 if(options.phase==='evidence_review'){
  assert.equal(options.onDelta,undefined,'an assessment must never be spoken');reviews++;
  return {text:JSON.stringify(reviews===1?assess('insufficient',[],'指示書だけでは実際の作業を確認できません。','杉山'):assess('supported',['work']))};
 }
 if(!f.searches)return {text:JSON.stringify({action:'search',query:'杉山 LP'})};
 answers++;assert.equal(f.searches,2);assert.equal(reviews,2);
 const text=JSON.stringify({action:'answer',text:'10月8日の記録では、申込フォームを修正し公開確認を完了しています。'});options.onDelta?.(text);return {text};
}});
assert.equal(answers,1);assert.equal(result.evidenceStatus,'supported');assert.deepEqual(result.sources.map(source=>source.uuid),['work']);assert.ok(!result.answer.includes('mention'));assert.match(deltas.join(''),/10月8日/);
assert.equal(f.tools.filter(t=>t.tool==='search_episodes').length,4);
// Unrelated complete bodies do not authorize a final answer or leak a draft delta.
f=fixture();reviews=0;deltas=[];
const insufficient=await converse({question:'杉山さんの作業内容教えて',groups,call:f.call,onDelta:x=>deltas.push(x),generate:async(messages,options)=>({text:JSON.stringify(options.phase==='evidence_review'?(reviews++,assess('insufficient',[],'今回の記録は指示で、実施内容を確認できません。','杉山')):{action:'search',query:'杉山'})})});
assert.equal(reviews,2);assert.equal(insufficient.evidenceStatus,'insufficient');assert.deepEqual(deltas,[]);assert.deepEqual(insufficient.sources,[]);
// A fabricated citation must fail closed even when the reviewer calls it supported.
f=fixture();await assert.rejects(converse({question:'杉山さんの作業内容教えて',groups,call:f.call,generate:async(messages,options)=>({text:JSON.stringify(options.phase==='evidence_review'?assess('supported',['invented']):{action:'search',query:'杉山'})})}),/根拠の評価/);
console.log('PASS implicit current-work retrieval, relevance review, retry before streaming, insufficient evidence and fabricated citation rejection');

f=fixture();const abort=new AbortController();let emittedAfterAbort=false;
await assert.rejects(converse({question:'杉山さんの作業内容教えて',groups,signal:abort.signal,call:f.call,onDelta:()=>{emittedAfterAbort=true;},generate:async(messages,options)=>{
 if(options.phase==='evidence_review'){abort.abort();return {text:JSON.stringify(assess('supported',['mention']))};}
 return {text:JSON.stringify({action:'search',query:'杉山'})};
}}),/中断/);assert.equal(emittedAfterAbort,false);
console.log('PASS cancellation during evidence review prevents final answer and streaming');

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
