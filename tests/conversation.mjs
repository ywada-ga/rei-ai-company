import assert from 'node:assert/strict';
import {converse,parseDecision} from '../conversation.mjs';
assert.throws(()=>parseDecision('{"action":"delete","text":"x"}'));
const groups=[{id:'allowed',name:'会社共有'}];
const make=actions=>async()=>({text:JSON.stringify(actions.shift())});
let calls=[],submitted=[];
const basic={question:'会社の予定は？',groups,call:async(tool,args)=>{calls.push({tool,args});return {content:[{type:'text',text:JSON.stringify({uuid:'record-1',group_id:'allowed',text:'資料',sources:[{traceable:true}]})}]};},submit:async instruction=>{submitted.push(instruction);return {id:'task',status:'approval_pending'};}};
const result=await converse({...basic,generate:make([{action:'search',query:'予定'},{action:'source',uuid:'record-1'},{action:'answer',text:'確認した予定です。'}])});
assert.equal(result.answer,'確認した予定です。');assert.equal(calls.length,2);assert.deepEqual(calls[0].args.group_ids,['allowed']);
await assert.rejects(converse({...basic,generate:make([{action:'episode',uuid:'outside'}])}),/取得済み/);
const unverified=await converse({...basic,generate:make([{action:'search',query:'予定'},...Array.from({length:5},()=>({action:'answer',text:'断定します'}))])});assert.match(unverified.answer,/まだ確定/);
const unavailable=await converse({...basic,call:async()=>({structuredContent:{uuid:'record-1',sources:[{traceable:false}]}}),generate:make([{action:'search',query:'予定'},{action:'source',uuid:'record-1'},{action:'answer',text:'断定します'}])});assert.match(unavailable.answer,/まだ確定/);
calls=[];
const hello=await converse({...basic,question:'こんにちは',groups:[],generate:make([{action:'answer',text:'こんにちは。'}])});assert.equal(hello.answer,'こんにちは。');assert.equal(calls.length,0);
const draft=await converse({...basic,question:'資料作成を作業依頼にして',generate:make([{action:'work',instruction:'資料作成'}])});assert.equal(draft.task.status,'approval_pending');assert.deepEqual(submitted,['資料作成を作業依頼にして']);
const controller=new AbortController();controller.abort();await assert.rejects(converse({...basic,signal:controller.signal,generate:make([])}),/中断/);
assert.equal(submitted.length,1);
console.log('conversation scope, evidence, approval and cancellation tests passed');

let iterations=0;calls=[];
const auto=await converse({...basic,generate:async()=>{iterations++;return {text:JSON.stringify(iterations===1?{action:'search',query:'予定'}:{action:'answer',text:'原記録を確認した予定です。'})};},call:async(tool,args)=>{calls.push(tool);return tool==='search_memory_facts'?{structuredContent:{facts:[{uuid:'record-2',fact:'予定',group_id:'allowed'}]}}:{structuredContent:{sources:[{traceable:true}]}};}});
assert.equal(iterations,2);assert.deepEqual(calls,['search_memory_facts','get_fact_source']);assert.match(auto.answer,/原記録/);
const rewrite=await converse({...basic,question:'今の文章を短く作って',generate:make([{action:'answer',text:'短くした本文です。'}])});assert.equal(rewrite.answer,'短くした本文です。');assert.equal(submitted.length,1);

const denied=await converse({...basic,generate:make([{action:'search',query:'予定'},{action:'answer',text:'断定'}]),call:async tool=>tool==='search_memory_facts'?{structuredContent:{facts:[{uuid:'record-3',fact:'未確認'}]}}:{structuredContent:{sources:[{traceable:false}]}}});assert.match(denied.answer,/まだ確定/);
let asked=0;await assert.rejects(converse({...basic,question:'REIから会社の売上を教えて',generate:async()=>{asked++;if(asked>1)throw Error('must search');return {text:'{"action":"answer","text":"未検証の数字"}'};}}),/must search/);
