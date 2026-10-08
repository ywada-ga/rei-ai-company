import assert from 'node:assert/strict';
import {additionWindow,readAdditions} from '../conversation-updates.mjs';
import {converse} from '../conversation.mjs';
const now=Date.parse('2026-10-08T08:00:00Z'),window=additionWindow('今日追加された新情報',now);
assert.equal(new Date(window.start).toISOString(),'2026-10-07T15:00:00.000Z');
assert.equal(additionWindow('今日の売上',now),null);
assert.equal(additionWindow('昨日追加された情報',now).end,window.start);
const groups=[{id:'g',name:'共有'}],cache=new Map(),requests=[];
const row=(id,at)=>({episode_uuid:id,group_id:'g',created_at:at});
const today1=row('today-1','2026-10-08T01:00:00Z'),today2=row('today-2','2026-10-08T02:00:00Z');
let scans=0;
const call=async(tool,args)=>{
 requests.push({tool,args});
 if(tool==='survey_space')return {structuredContent:{coverage:{complete:true}}};
 if(tool==='get_updates'){
 assert.equal(args.advance,false);assert.deepEqual(args.group_ids,['g']);
 if(!args.cursor)return {structuredContent:{episodes:[row('old','2026-09-01'),today1],next_cursor:'page-1',truncated:true,coverage:{complete:false,reasons:['limit_reached']}}};
 scans++;return {structuredContent:{episodes:[today1,today2],next_cursor:'end',truncated:false,coverage:{complete:true}}};
 }
 if(tool==='get_episode')return {structuredContent:{episode:{uuid:args.uuid,group_id:'g',origin:'mcp',content:'今日追加された実機確認の記録。',source_ref:null,author_subject:'authenticated-fixture',recorded_at:'2026-10-08T02:00:00Z'},coverage:{complete:true}}};
 throw Error('must use the ledger, not ranked fact search');
};
const first=await readAdditions({groups,window,cache,call});assert.equal(first.rows.length,2);assert.equal(first.complete,true);assert.equal(scans,1);
requests.length=0;await readAdditions({groups,window,cache,call});assert.equal(requests[0].args.cursor,'end');assert.equal(requests.length,1,'every read checks new additions without replaying all old pages');
const capped=await readAdditions({groups,window,call,maxPages:1});assert.equal(capped.complete,false);assert.equal(capped.rows.length,1);
await assert.rejects(readAdditions({groups,window,call:async()=>({structuredContent:{episodes:[{...today1,group_id:'outside'}],coverage:{complete:true},truncated:false}})}),/範囲/);
const progress=[],historyCalls=[];
const answer=await converse({question:'今日シナプスコネクトに追加された新情報をまとめて教えて',groups,onProgress:e=>progress.push(e.stage),call:async(t,a)=>{historyCalls.push(t);const result=await call(t,a);if(t==='get_updates')result.structuredContent.episodes=result.structuredContent.episodes.map(r=>r.episode_uuid.startsWith('today-')?{...r,created_at:new Date(additionWindow('今日追加').start+3600000).toISOString()}:r);return result;},generate:async(messages,options)=>{
 assert.equal(options.phase,'evidence_answer');assert.ok(messages.some(m=>m.content.includes('当日の追加本文を確認')));
 return {text:JSON.stringify({action:'respond',status:'supported',sourceIds:['today-1','today-2'],reason:'',query:'',text:'今日追加された2件を確認しました。実機確認の記録です。'})};
}});
assert.equal(answer.additions.confirmedCount,2);assert.equal(answer.additions.verifiedBodies,2);assert.equal(answer.additions.scopeComplete,true);assert.equal(answer.sources.length,2);
assert.ok(!historyCalls.includes('search_memory_facts'));assert.deepEqual(progress,['outline','search','additions','source','summarize']);
console.log('PASS JST additions, readonly pagination, overlap deduplication, cursor reuse, incomplete coverage, scoped full bodies and live progress');
const unproven=await converse({question:'今日シナプスコネクトに追加された情報',groups,generate:()=>{throw Error('must not answer from unattributed body');},call:async(t,a)=>{
 const result=await call(t,a);
 if(t==='get_updates')result.structuredContent.episodes=result.structuredContent.episodes.map(r=>r.episode_uuid.startsWith('today-')?{...r,created_at:new Date(additionWindow('今日追加').start+3600000).toISOString()}:r);
 if(t==='get_episode')result.structuredContent.episode.author_subject=null;
 return result;
}});
assert.equal(unproven.additions.verifiedBodies,0);assert.equal(unproven.sources.length,0);assert.match(unproven.answer,/ないとは断定できません/);
console.log('PASS MCP records with no source reference require a recorded author; unattributed bodies cannot authorize answers');
