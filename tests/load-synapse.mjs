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
steps=[];round=0;let activeSearches=0,peakSearches=0,bodyReads=0;
const recent=await converse({question:'会社の案件Aは今どうなった？',groups,generate:async messages=>{
 if(++round===1)return {text:'{"action":"search","query":"案件A"}'};
 assert.ok(messages.some(m=>m.content.includes('案件Aは金曜日の予定')));
 assert.ok(!messages.some(m=>m.content.includes('未読の検索候補だけの主張')||m.content.includes('未確認の出典だけの主張')||m.content.includes('未読の原文候補だけの主張')));
 return {text:'{"action":"answer","text":"保存本文に書かれた予定です。"}'};
},call:async(tool,args)=>{
 if(['search_memory_facts','search_episodes'].includes(tool)){activeSearches++;peakSearches=Math.max(peakSearches,activeSearches);await new Promise(r=>setTimeout(r,20));activeSearches--;}
 if(tool==='search_memory_facts'){steps.push(tool);return {structuredContent:{facts:[{uuid:'fact-old',group_id:'allowed',fact:'未読の検索候補だけの主張'}]}};}
 if(tool==='get_fact_source'){steps.push(tool);return {structuredContent:{fact:{fact:'未確認の出典だけの主張'},sources:[{group_id:'allowed',episode_uuid:'episode-a'}]}};}
 if(tool==='get_episode'){bodyReads++;assert.equal(args.group_id,'allowed');}
 if(tool==='search_episodes'){const result=await call(tool,args);result.structuredContent.episodes[0].content='未読の原文候補だけの主張';return result;}
 return call(tool,args);
}});
assert.ok(steps.includes('search_episodes'));assert.equal(recent.synapseRead,true);assert.equal(peakSearches,2);assert.equal(activeSearches,0);assert.equal(bodyReads,1);
round=0;
await converse({question:'会社の案件Aは今どうなった？',groups,generate:async()=>({text:JSON.stringify(++round===1?{action:'search',query:'案件A'}:{action:'answer',text:'保存された予定です。'})}),call:async(tool,args)=>{if(tool==='get_episode')bodyReads++;return call(tool,args);}});
assert.equal(bodyReads,2,'a separate question must fetch a fresh body');
round=0;
const mixed=await converse({question:'会社の案件Bは？',groups,generate:async messages=>{
 if(++round===1)return {text:'{"action":"search","query":"案件B"}'};
 const prompt=JSON.stringify(messages);assert.ok(prompt.includes('確認済みの本文です'));
 for(const text of ['未検証の事実要約','未確認の隣接本文','範囲外の本文','省略された本文'])assert.ok(!prompt.includes(text),text);
 return {text:'{"action":"answer","text":"確認した本文に基づく回答です。"}'};
},call:async(tool,args)=>{
 if(tool==='get_fact_source')return {structuredContent:{fact:{fact:'未検証の事実要約'},sources:[
  {group_id:'allowed',traceable:true,body:'確認済みの本文です',source_ref:'fixture:confirmed'},
  {group_id:'allowed',traceable:false,body:'未確認の隣接本文'},
  {group_id:'other',traceable:true,body:'範囲外の本文'},
  {group_id:'allowed',traceable:true,content_truncated:true,body:'省略された本文'}
 ]}};
 if(tool==='search_memory_facts')return {structuredContent:{facts:[{uuid:'fact-b',group_id:'allowed',fact:'未検証の事実要約'}]}};
 return call(tool,args);
}});
assert.equal(mixed.synapseRead,true);
console.log('PASS load-synapse outline, graph search, episode fallback, full body lookup and unavailable-group no-retry');

// An episode body must not hold up an independent fact source request.
round=0;let sourceStarted;const sourceGate=new Promise(resolve=>{sourceStarted=resolve;});
let simultaneousReads=0,peakReads=0;
await converse({question:'会社の案件Aは今どうなった？',groups,generate:async()=>({text:JSON.stringify(++round===1?{action:'search',query:'案件A'}:{action:'answer',text:'保存された予定です。'})}),call:async(tool,args)=>{
 if(tool==='search_memory_facts')return {structuredContent:{facts:[{uuid:'fact-a',group_id:'allowed'}]}};
 if(tool==='get_episode'||tool==='get_fact_source'){
  simultaneousReads++;peakReads=Math.max(peakReads,simultaneousReads);
  if(tool==='get_fact_source')sourceStarted();
  let timer;
  try{await Promise.race([sourceGate,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('source request blocked behind episode body')),500);})]);await new Promise(resolve=>setTimeout(resolve,10));}
  finally{clearTimeout(timer);simultaneousReads--;}
  if(tool==='get_fact_source')return {structuredContent:{sources:[{group_id:'allowed',episode_uuid:'episode-a'}]}};
 }
 return call(tool,args);
}});
assert.equal(peakReads,2);assert.equal(simultaneousReads,0);
round=0;let forbiddenReads=0;
const unavailableRecent=await converse({question:'会社の案件Aは今どうなった？',groups,generate:async()=>({text:'{"action":"search","query":"案件A"}'}),call:async(tool,args)=>{
 if(tool==='search_memory_facts')return {structuredContent:{facts:[{uuid:'fact-a',group_id:'allowed'}]}};
 if(tool==='search_episodes')return denied;
 if(tool==='get_fact_source'||tool==='get_episode'){forbiddenReads++;throw new Error('must not read an unavailable group');}
 return call(tool,args);
}});
assert.equal(forbiddenReads,0);assert.match(unavailableRecent.answer,/アクセスできず/);
console.log('PASS episode and source overlap after coverage validation, with answer gate and no unavailable-group reads');

round=0;const broadOrder=[];
await converse({question:'テストグループについて教えてください',groups,generate:async messages=>{
 broadOrder.push('model');assert.equal(broadOrder[0],'survey_space','a named group overview must survey before the first model call');
 assert.ok(messages.some(message=>message.content.includes('全体像')));
 return {text:JSON.stringify(++round===1?{action:'search',query:'テストグループ'}:{action:'answer',text:'本文に基づく概要です。'})};
},call:async(tool,args)=>{broadOrder.push(tool);return call(tool,args);}});
assert.equal(broadOrder.filter(step=>step==='model').length,2);
console.log('PASS named company-group overview starts scoped survey before planning, avoiding a discarded model round');
