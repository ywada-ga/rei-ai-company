import assert from 'node:assert/strict';
import {runProvisionalConversation,selectPrefetchedRecords} from '../conversation-provisional.mjs';
import {prefetchScopeKey} from '../conversation-prefetch.mjs';

const at=Date.now(),scope={userId:'fixture-owner',role:'owner',integration:'fixture',groups:[{id:'fixture-group',personal:false}]};
const episode={uuid:'fixture-source',group_id:'fixture-group',name:'架空会社',content:'架空会社の担当は青山。',origin:'manual',recorded_at:new Date(at).toISOString(),source_ref:'fixture'};
const snapshot={version:1,scopeKey:'conversation-prefetch:'+prefetchScopeKey(scope),checkedAt:at,bodyCoverage:'limited',records:[{episode,addedAt:new Date(at).toISOString(),fetchedAt:at}]};
const decision={action:'respond',status:'supported',sourceIds:[episode.uuid],reason:'',query:'',text:'担当は青山です。'};
const result=(body=episode.content)=>({answer:'担当は青山です。',spokenAnswer:'担当は青山です。',synapseRead:true,evidenceStatus:'supported',sources:[{uuid:episode.uuid}],evidence:[{tool:'get_episode',uuid:episode.uuid,result:{structuredContent:{episode:{...episode,content:body},coverage:{complete:true}}}}]});
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const settle=()=>new Promise(r=>setImmediate(r));
async function scenario(overrides={}){
 const latest=defer(),events=[],opts={question:'架空会社について教えて',scope,getSnapshot:async()=>structuredClone(snapshot),authorize:async()=>true,generate:async()=>({text:JSON.stringify(decision)}),verify:()=>latest.promise,onEvent:e=>events.push(e),...overrides};
 const pending=runProvisionalConversation(opts);await settle();return {latest,events,pending};
}

assert.equal(selectPrefetchedRecords(snapshot,'それは？').length,0,'Do not guess a follow-up topic from cached answers');
assert.equal(selectPrefetchedRecords(snapshot,'別会社について教えて').length,0);
assert.equal(selectPrefetchedRecords(snapshot,'架空会社について教えて').length,1);
{
 const s=await scenario();assert.equal(s.events[0].type,'provisional');assert.match(s.events[0].text,/取得時点の暫定情報/);assert.equal(s.events[0].verification,'pending');
 s.latest.resolve(result());const out=await s.pending;assert.deepEqual(s.events.map(e=>e.type),['provisional','verified','done']);assert.equal(out.provisionalUsed,true);
 assert.equal(s.events[1].replacementAnswer,result().answer);assert.ok(out.provisionalTiming.verifiedMs>=out.provisionalTiming.provisionalMs);
}
{
 const s=await scenario();s.latest.resolve({...result('担当は赤井に変更。'),answer:'担当は赤井です。',spokenAnswer:'担当は赤井です。'});await s.pending;
 assert.equal(s.events[1].type,'correction');assert.match(s.events[1].text,/^先ほどの点、訂正です。担当は赤井/);
}
{
 const s=await scenario();s.latest.resolve({...result(),answer:decision.text+'窓口は開発室です。',spokenAnswer:decision.text+'窓口は開発室です。'});await s.pending;
 assert.deepEqual(s.events.map(e=>e.type),['provisional','verified','supplement','done']);assert.equal(s.events[2].text,'補足です。窓口は開発室です。');
}
{
 const s=await scenario();s.latest.resolve({...result(),sources:[],evidenceStatus:'insufficient',answer:'今回確認できた根拠が不足しています。'});await s.pending;
 assert.equal(s.events[1].type,'correction');assert.equal(s.events[1].verification,'insufficient');
}
{
 const s=await scenario({getSnapshot:async()=>({...snapshot,checkedAt:at-700000})});assert.equal(s.events.length,0);s.latest.resolve(result());await s.pending;assert.equal(s.events[0].type,'answer');
}
{
 const s=await scenario({getSnapshot:async()=>({...snapshot,scopeKey:'other-user'})});s.latest.resolve(result());await s.pending;assert.equal(s.events[0].type,'answer');
}
{
 const s=await scenario({generate:async()=>({text:JSON.stringify({...decision,sourceIds:['unread-source']})})});s.latest.resolve(result());await s.pending;assert.equal(s.events[0].type,'answer');
}
{
 let calls=0;const s=await scenario({authorize:async()=>++calls>1});assert.equal(s.events.length,0);s.latest.resolve(result());await s.pending;assert.equal(s.events[0].type,'answer');
}
{
 const slow=defer();const s=await scenario({generate:()=>slow.promise});s.latest.resolve(result());const out=await s.pending;assert.equal(out.provisionalUsed,false);
 slow.resolve({text:JSON.stringify(decision)});await settle();assert.deepEqual(s.events.map(e=>e.type),['answer','done'],'Late provisional generation cannot append after completion');
}
{
 const controller=new AbortController(),s=await scenario({signal:controller.signal});assert.equal(s.events[0].type,'provisional');controller.abort();s.latest.resolve(result());await assert.rejects(s.pending,/中断/);assert.equal(s.events.length,1);
}
{
 const controller=new AbortController(),s=await scenario({signal:controller.signal});controller.abort();await assert.rejects(s.pending,/中断/);
 s.latest.resolve(result());await settle();assert.equal(s.events.length,1,'Abort-ignoring verification cannot emit after cancellation');
}
{
 let allowed=true;const s=await scenario({authorize:async()=>allowed});allowed=false;s.latest.resolve(result());await assert.rejects(s.pending,/権限/);
 assert.deepEqual(s.events.map(e=>e.type),['provisional','correction']);assert.equal(s.events[1].verification,'failed');assert.deepEqual(s.events[1].sourceIds,[]);
}
{
 let calls=0;const s=await scenario({authorize:async()=>{if(++calls===2)throw new Error('Permission transport failed');return true;}});s.latest.resolve(result());await assert.rejects(s.pending,/transport/);
 assert.deepEqual(s.events.map(e=>e.type),['provisional','verification_failed']);
}
{
 const s=await scenario({verify:async()=>{await settle();await settle();throw new Error('Fixture retrieval failed');}});await assert.rejects(s.pending,/retrieval failed/);assert.deepEqual(s.events.map(e=>e.type),['provisional','verification_failed']);assert.equal(s.events[1].verification,'failed');
}
console.log('Provisional conversation: scoped evidence, expiry, correction, fallback, cancellation and races passed');

{
 const fresh=defer(),started=defer(),events=[];
 const pending=runProvisionalConversation({question:'架空会社について教えて',scope,getSnapshot:async()=>null,authorize:async()=>true,generate:async()=>{throw Error('not called');},verify:async({onDelta})=>{await settle();onDelta('担当は青山です。');started.resolve();await fresh.promise;return result();},onEvent:e=>events.push(e)});
 await started.promise;assert.equal(events[0].type,'delta','Unavailable prefetch preserves fresh streaming before completion');fresh.resolve();await pending;
 assert.equal(events[1].speechText,'','Already streamed final speech is not repeated');
}
{
 const s=await scenario({generate:async(messages,options)=>({text:JSON.stringify(options.phase==='verification_supplement'?{...decision,text:'開発室で対応します。'}:decision)})});
 s.latest.resolve({...result(),answer:'開発室で対応しており、担当は青山です。',spokenAnswer:'開発室で対応しており、担当は青山です。'});await s.pending;
 assert.equal(s.events.find(e=>e.type==='supplement').speechText,'補足です。開発室で対応します。');
 assert.ok(s.events.at(-1).result.streamedSpokenAnswer.includes('補足です。'));
}
console.log('PASS fresh stream fallback and source-checked rephrased supplement');
{
 const s=await scenario({question:'今日追加された新情報を教えて',generate:async messages=>{const payload=JSON.parse(messages[1].content);assert.equal(payload.timeZone,'Asia/Tokyo');assert.match(payload.now,/T/);assert.match(payload.checkedAt,/T/);assert.match(payload.additionDate,/^\d{4}-\d{2}-\d{2}$/);assert.equal(payload.records.length,1);return {text:JSON.stringify({...decision,status:'partial'})};}});
 assert.equal(s.events[0].type,'provisional');assert.match(s.events[0].text,/一部の記録/);s.latest.resolve(result());await s.pending;
}
console.log('PASS day questions carry explicit current date, Japan time and partial-scope wording');

// The first sentence must escape the full-model completion barrier while its
// permissions, validated header and final history remain separate.
{
 const model=defer(),gate=defer();let stream;
 const s=await scenario({authorize:()=>gate.promise,generate:(_messages,opts)=>{stream=opts.onDelta;return model.promise;}});
 const raw=JSON.stringify({...decision,text:'担当は青山です。窓口は開発室です。'});
 stream(raw.slice(0,raw.indexOf('窓口')));await settle();assert.equal(s.events.length,0,'Permission gate blocks early speech');
 gate.resolve(true);await settle();assert.equal(s.events[0].type,'provisional');assert.equal(s.events[0].speechText,'暫定ですが、担当は青山です。');
 assert.equal(s.events.length,1,'First sentence released while model still running');
 model.resolve({text:raw});await settle();assert.equal(s.events[1].type,'provisional');assert.match(s.events[1].speechText,/^窓口は開発室/);
 s.latest.resolve({...result(),answer:'担当は青山です。窓口は開発室です。',spokenAnswer:'担当は青山です。窓口は開発室です。'});
 const out=await s.pending;assert.equal(out.provisionalUsed,true);assert.equal(s.events.filter(e=>e.type==='correction').length,0);
 assert.equal(out.streamedSpokenAnswer.split('担当は青山です。').length,2,'No repeat of first factual sentence');
}
for(const update of [{sourceIds:['unread-source']},{sourceIds:[episode.uuid,episode.uuid]},{status:'insufficient'},{query:'search again'}]){
 const model=defer();let stream;
 const s=await scenario({generate:(_messages,opts)=>{stream=opts.onDelta;return model.promise;}});
 const raw=JSON.stringify({...decision,...update});stream(raw);await settle();assert.equal(s.events.length,0);
 model.resolve({text:raw});await settle();s.latest.resolve(result());await s.pending;assert.equal(s.events[0].type,'answer');
}
{
 const model=defer();let stream;
 const s=await scenario({generate:(_messages,opts)=>{stream=opts.onDelta;return model.promise;}});
 stream(JSON.stringify(decision).slice(0,-2));await settle();assert.equal(s.events[0].type,'provisional');
 model.resolve({text:'malformed final'});await settle();assert.equal(s.events[1].type,'correction');assert.match(s.events[1].text,/完了できません/);
 s.latest.resolve(result());const out=await s.pending;assert.equal(s.events.filter(e=>e.type==='verified').length,0,'Malformed prefix cannot become verified through a same-body hash');
 assert.equal(out.answer,result().answer,'Only fresh final answer is authoritative');
}
{
 const model=defer(),gate=defer();let stream;
 const s=await scenario({authorize:()=>gate.promise,generate:(_messages,opts)=>{stream=opts.onDelta;return model.promise;}});
 stream(JSON.stringify(decision));await settle();s.latest.resolve(result());await settle();gate.resolve(true);await s.pending;
 model.resolve({text:JSON.stringify(decision)});await settle();assert.deepEqual(s.events.map(e=>e.type),['answer','done'],'Late permission/model cannot release obsolete provisional');
}
console.log('PASS early provisional sentence, delayed permission, invalid header/final and latest-wins races');

{
 const model=defer(),gate=defer();let stream;
 const s=await scenario({authorize:()=>gate.promise,generate:(_messages,opts)=>{stream=opts.onDelta;return model.promise;}});
 stream(JSON.stringify(decision));await settle();model.resolve({text:'malformed final'});await settle();gate.resolve(true);await settle();
 assert.equal(s.events.length,0,'Late permission cannot revive a failed provisional generation');
 s.latest.resolve(result());await s.pending;assert.equal(s.events[0].type,'answer');
}
console.log('PASS permission completion cannot revive rejected provisional text');
