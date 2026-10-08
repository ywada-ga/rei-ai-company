import assert from 'node:assert/strict';
import {converse} from '../conversation.mjs';
import {episodeLookups,unavailableGroups,needsRecentEvidence} from '../load-synapse.mjs';
const groups=[{id:'allowed',name:'共有'}];let steps=[],round=0;
const call=async(tool,args)=>{
 steps.push(tool);assert.deepEqual(args.group_ids,['allowed']);
 if(tool==='survey_space')return {structuredContent:{spaces:[{group_id:'allowed',top_entities:[{name:'案件A'}]}],coverage:{complete:true}}};
 if(tool==='search_memory_facts')return {structuredContent:{facts:[],coverage:{reasons:['no_match']}}};
 if(tool==='search_episodes')return {structuredContent:{episodes:[{group_id:'allowed',content:'preview',content_truncated:true,full_content_lookup:{tool:'get_episode',arguments:{uuid:'episode-a',group_id:'allowed'}}}],coverage:{complete:false,truncated:true}}};
 assert.equal(tool,'get_episode');assert.equal(args.uuid,'episode-a');return {structuredContent:{episode:{uuid:'episode-a',group_id:'allowed',origin:'text',content:'案件Aは金曜日の予定',recorded_at:'2026-10-08T00:00:00Z',source_ref:'manual:fixture'},coverage:{complete:true}}};
};
const result=await converse({question:'会社の案件Aは？',groups,call,generate:async messages=>{
 assert.ok(messages.some(m=>m.content.includes('load-synapse 0.8.0')));round++;
 if(round===1)return {text:'{"action":"search","query":"案件A"}'};
 assert.ok(messages.some(m=>m.content.includes('案件Aは金曜日の予定')));return {text:'{"action":"answer","text":"保存本文では金曜日の予定です。"}'};
}});
assert.deepEqual(steps,['survey_space','search_memory_facts','search_episodes','get_episode']);assert.equal(result.readingSkill.name,'load-synapse');assert.equal(result.synapseRead,true);assert.match(result.answer,/未照合/);
const previewOnly={structuredContent:{episodes:[{group_id:'allowed',uuid:'not-evidence',content:'preview',content_truncated:true}]}};
assert.deepEqual(episodeLookups(previewOnly,groups),[]);
assert.deepEqual(episodeLookups({structuredContent:{episodes:[{group_id:'allowed',full_content_lookup:{tool:'delete',arguments:{uuid:'bad'}}}]}},groups),[]);
const denied={structuredContent:{coverage:{reasons:['group_unavailable']}}};assert.deepEqual(unavailableGroups(denied,groups),['allowed']);
let calls=0;
const blocked=await converse({question:'会社の案件は？',groups,call:async tool=>{calls++;assert.equal(tool,'survey_space');return denied;},generate:()=>{throw Error('must not retry inaccessible group');}});
assert.equal(calls,1);assert.match(blocked.answer,/アクセスできず/);
assert.deepEqual(unavailableGroups({structuredContent:{coverage:{reasons:['group_unavailable'],degraded:[{group_id:'a',reason:'group_unavailable'}]}}},[{id:'a'},{id:'b'}]),['a']);
await assert.rejects(converse({question:'会社の案件は？',groups,generate:async()=>({text:'{"action":"search","query":"案件A"}'}),call:async tool=>tool==='survey_space'?{structuredContent:{coverage:{complete:true}}}:tool==='search_memory_facts'?{structuredContent:{facts:[]}}:{isError:true}}),/原文検索に失敗/);
assert.equal(needsRecentEvidence('シナプスにあると思うんだけど',[{question:'昨日のデータは？'}]),true);
assert.equal(needsRecentEvidence('案件Aの説明'),false);
const datedRows={structuredContent:{episodes:[{uuid:'old',group_id:'allowed',created_at:'2026-09-01',content_representation:'full',content:'old'},{uuid:'new',group_id:'allowed',created_at:'2026-10-08',content_representation:'full',content:'new'}]}};
assert.deepEqual(episodeLookups(datedRows,groups,{recent:true}).map(x=>x.uuid),['new','old']);
steps=[];round=0;let activeSearches=0,peakSearches=0;
const recent=await converse({question:'会社の案件Aは今どうなった？',groups,generate:async messages=>{
 if(++round===1)return {text:'{"action":"search","query":"案件A"}'};
 assert.ok(messages.some(m=>m.content.includes('案件Aは金曜日の予定')));return {text:'{"action":"answer","text":"保存本文に書かれた予定です。"}'};
},call:async(tool,args)=>{
 if(['search_memory_facts','search_episodes'].includes(tool)){activeSearches++;peakSearches=Math.max(peakSearches,activeSearches);await new Promise(r=>setTimeout(r,20));activeSearches--;}
 if(tool==='search_memory_facts'){steps.push(tool);return {structuredContent:{facts:[{uuid:'fact-old',group_id:'allowed',fact:'古い予定'}]}};}
 if(tool==='get_fact_source'){steps.push(tool);return {structuredContent:{sources:[]}};}
 return call(tool,args);
}});
assert.ok(steps.includes('search_episodes'));assert.equal(recent.synapseRead,true);assert.equal(peakSearches,2);assert.equal(activeSearches,0);
console.log('PASS load-synapse outline, graph search, episode fallback, full body lookup and unavailable-group no-retry');
