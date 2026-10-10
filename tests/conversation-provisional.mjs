import assert from 'node:assert/strict';
import {runProvisionalConversation,selectPrefetchedRecords,prefetchTopicQuestion} from '../conversation-provisional.mjs';
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
 const question='架空会社の注意点を教えて',text='権限と利用範囲を事前に確認してください。',body='架空会社の注意点は、権限と利用範囲を事前に確認すること。';
 const cached=structuredClone(snapshot);cached.records[0].episode.content=body;
 assert.equal(prefetchTopicQuestion(question),question);
 assert.equal(prefetchTopicQuestion('もっと詳しく教えて',[{question,synapseRead:true}]),question);
 assert.equal(prefetchTopicQuestion('もっと詳しく教えて',[{question,synapseRead:false}]),null);
 assert.equal(selectPrefetchedRecords(cached,question).length,1);
 for(const q of ['量子力学の注意点を教えて','その会社の注意点を教えて','REIの注意点を教えて','架空会社と別会社の注意点を教えて','架空会社の注意点を教えて。実行して'])assert.equal(prefetchTopicQuestion(q),null);
 let payload,latestCalls=0;const fresh=defer();
 const s=await scenario({question,getSnapshot:async()=>cached,generate:async messages=>{payload=JSON.parse(messages.at(-1).content);return {text:JSON.stringify({...decision,text})};},verify:()=>{latestCalls++;return fresh.promise;}});
 assert.equal(payload.question,question);assert.equal(payload.topicQuestion,question);assert.equal(latestCalls,1);
 assert.equal(s.events[0].verification,'pending');assert.match(s.events[0].text,/取得時点の暫定情報/);
 fresh.resolve({...result(body),answer:text,spokenAnswer:text});assert.equal((await s.pending).provisionalUsed,true);
 assert.deepEqual(s.events.map(e=>e.type),['provisional','verified','done']);
 const denied=await scenario({question,getSnapshot:async()=>cached,authorize:async()=>false});assert.equal(denied.events.length,0);
 denied.latest.resolve(result(body));await assert.rejects(denied.pending,/利用権限/);
 for(const overrides of [{getSnapshot:async()=>({...cached,checkedAt:at-700000})},{generate:async()=>({text:JSON.stringify({...decision,status:'insufficient',sourceIds:[],text:''})})}]){
  const fallback=await scenario({question,getSnapshot:async()=>cached,...overrides});assert.equal(fallback.events.length,0);
  fallback.latest.resolve({...result(body),answer:text,spokenAnswer:text});assert.equal((await fallback.pending).provisionalUsed,false);
 }
}
console.log('PASS explicit company cautions retain the original request, pending timestamp, independent latest reads and fallback gates');
{
 const s=await scenario();assert.equal(s.events[0].type,'provisional');assert.match(s.events[0].text,/取得時点の暫定情報/);assert.equal(s.events[0].verification,'pending');
 s.latest.resolve(result());const out=await s.pending;assert.deepEqual(s.events.map(e=>e.type),['provisional','verified','done']);assert.equal(out.provisionalUsed,true);
 assert.equal(s.events[1].replacementAnswer,result().answer);assert.ok(out.provisionalTiming.verifiedMs>=out.provisionalTiming.provisionalMs);
}
{
 const s=await scenario();s.latest.resolve({...result('担当は赤井に変更。'),answer:'担当は赤井です。',spokenAnswer:'担当は赤井です。'});await s.pending;
 assert.equal(s.events[1].type,'correction');assert.match(s.events[1].text,/^先ほどの点、訂正です。担当は赤井/);
}
for(const state of [{deleted:true},{invalid_at:'2026-10-10T00:00:00Z'},{is_latest_revision:false}]){
 for(const location of ['root','episode']){
  const s=await scenario(),fresh=result(),data=fresh.evidence[0].result.structuredContent;
  Object.assign(location==='root'?data:data.episode,state);
  s.latest.resolve(fresh);await s.pending;
  assert.equal(s.events[1].type,'correction',`${location} state cannot confirm cached evidence: ${JSON.stringify(state)}`);
  assert.equal(s.events.filter(e=>e.type==='verified'||e.type==='supplement').length,0);
 }
}
console.log('PASS root and episode deletion, expiry and old revision cannot confirm provisional body equality');
{
 const s=await scenario(),fresh=result();
 fresh.answer=fresh.spokenAnswer='担当は未確認です。青山への依頼記録だけでは担当確定を示しません。';
 s.latest.resolve(fresh);await s.pending;
 assert.equal(s.events[1].type,'correction','Same source body cannot confirm a claim rejected by the fresh answer');
 assert.equal(s.events.filter(e=>e.type==='verified'||e.type==='supplement').length,0);
}
// A retry can read the same ID twice. Neither order may hide a changed body
// or a failed/deleted read when confirming the cached provisional source.
for(const kind of ['changed','group','deleted','incomplete','error']){
 for(const reverse of [false,true]){
  const s=await scenario(),fresh=result(),other=structuredClone(fresh.evidence[0]);
  if(kind==='changed')other.result.structuredContent.episode.content='架空会社の担当は赤井。';
  if(kind==='group')other.result.structuredContent.episode.group_id='other-group';
  if(kind==='deleted')other.result.structuredContent.deleted=true;
  if(kind==='incomplete')other.result.structuredContent.coverage.complete=false;
  if(kind==='error')other.result={isError:true};
  fresh.evidence=reverse?[other,...fresh.evidence]:[...fresh.evidence,other];
  s.latest.resolve(fresh);await s.pending;
  assert.equal(s.events[1].type,'correction',`${kind}/${reverse}: conflicting reads cannot confirm cached evidence`);
  assert.equal(s.events.filter(e=>e.type==='verified'||e.type==='supplement').length,0);
 }
}
{
 const s=await scenario(),fresh=result();fresh.evidence.push(structuredClone(fresh.evidence[0]));
 s.latest.resolve(fresh);await s.pending;
 assert.deepEqual(s.events.map(e=>e.type),['provisional','verified','done'],'Identical complete rereads remain usable');
}
console.log('PASS conflicting duplicate reads cannot restore provisional verification in either order');
{
 const s=await scenario(),fresh=result(),conflict=result('変更後の本文').evidence[0];
 fresh.evidence.push(conflict,structuredClone(fresh.evidence[0]));
 s.latest.resolve(fresh);await s.pending;assert.equal(s.events[1].type,'correction','A third matching read cannot erase a conflict');
}
{
 const s=await scenario(),fresh=result();fresh.evidence.push({tool:'get_episode',uuid:'unrelated-source',result:{isError:true}});
 s.latest.resolve(fresh);await s.pending;assert.equal(s.events[1].type,'verified','An unrelated failed ID does not invalidate the selected source');
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
 let calls=0;const s=await scenario({authorize:async()=>{if(++calls===2)throw new Error('Permission transport failed');return true;}});s.latest.resolve(result());await assert.rejects(s.pending,/権限/);
 assert.deepEqual(s.events.map(e=>e.type),['provisional','correction']);assert.ok(!s.events[1].replacementAnswer.includes('青山'));
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
// Rephrasing is not sufficient proof that all provisional claims survived.
for(const full of ['開発室で対応しており、担当は青山です。','担当は赤井です。','担当は未確認です。']){
 let generated=0;
 const s=await scenario({generate:async()=>{generated++;return {text:JSON.stringify(decision)};}});
 s.latest.resolve({...result(),answer:full,spokenAnswer:full});const out=await s.pending;
 assert.deepEqual(s.events.map(e=>e.type),['provisional','correction','done']);
 assert.equal(s.events[1].speechText,'先ほどの点、訂正です。'+full);
 assert.equal(s.events[1].replacementAnswer,full);assert.equal(out.answer,full);
 assert.equal(generated,1,'Changed or rephrased claims require no extra difference model');
 assert.equal(out.provisionalTiming.supplementModelMs,null);
}
console.log('PASS fresh stream fallback and changed claims use explicit correction without another model');
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
 gate.resolve(true);await settle();assert.equal(s.events[0].type,'provisional');assert.match(s.events[0].speechText,/^\d+月\d+日\d+時\d+分取得の、一部の記録による暫定ですが、担当は青山です。$/);
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

// Begin the gate while the checked text is incomplete; never speak a fragment.
{
 const model=defer(),gate=defer();let stream,calls=0,tick=0;
 const s=await scenario({now:()=>at+tick,authorize:()=>{calls++;return gate.promise;},generate:(_m,o)=>{stream=o.onDelta;return model.promise;}});
 const raw=JSON.stringify(decision),partial=raw.slice(0,raw.indexOf('です。'));
 stream(partial);await settle();assert.equal(calls,1);assert.equal(s.events.length,0);
 tick=500;stream(raw);await settle();assert.equal(calls,1);assert.equal(s.events.length,0);
 tick=1000;gate.resolve(true);await settle();assert.equal(s.events[0].type,'provisional');
 model.resolve({text:raw});await settle();s.latest.resolve(result());const out=await s.pending;
 assert.equal(out.provisionalTiming.permissionStartedMs,0);assert.equal(out.provisionalTiming.firstSentenceMs,500);
 assert.equal(out.provisionalTiming.permissionChecks,1);
}
// A valid source header overlaps permission with first-sentence generation.
{
 const model=defer(),gate=defer();let stream,calls=0,tick=0;
 const s=await scenario({now:()=>at+tick,authorize:()=>{calls++;return gate.promise;},generate:(_m,o)=>{stream=o.onDelta;return model.promise;}});
 const raw=JSON.stringify(decision),empty=raw.slice(0,raw.indexOf('担当'));
 stream(empty);await settle();assert.equal(calls,1,'Valid header starts permission before answer text');assert.equal(s.events.length,0);
 tick=400;gate.resolve(true);await settle();assert.equal(s.events.length,0,'Permission alone cannot speak');
 tick=800;stream(raw);await settle();assert.equal(s.events[0].type,'provisional');assert.equal(calls,1);
 model.resolve({text:raw});await settle();s.latest.resolve(result());const out=await s.pending;
 assert.equal(out.provisionalTiming.permissionStartedMs,0);assert.equal(out.provisionalTiming.firstSentenceMs,800);
}
// A slow sentence cannot reuse an early authorization after it becomes old.
{
 const model=defer(),renew=defer();let stream,calls=0,tick=0;
 const s=await scenario({now:()=>at+tick,authorize:()=>++calls===1?Promise.resolve(true):calls===2?renew.promise:Promise.resolve(true),generate:(_m,o)=>{stream=o.onDelta;return model.promise;}});
 const raw=JSON.stringify(decision);stream(raw.slice(0,raw.indexOf('です。')));await settle();assert.equal(calls,1);
 tick=1001;stream(raw);await settle();assert.equal(calls,2);assert.equal(s.events.length,0,'Expired gate does not release text');
 renew.resolve(false);await settle();assert.equal(s.events.length,0,'Revoked scope suppresses provisional text');
 model.resolve({text:raw});await settle();s.latest.resolve(result());const out=await s.pending;
 assert.equal(out.provisionalUsed,false);assert.equal(out.provisionalTiming.permissionChecks,2);
}
// Invalid headers cannot start speculative permission requests either.
for(const update of [{sourceIds:['unread-source']},{sourceIds:[episode.uuid,episode.uuid]},{status:'insufficient'},{query:'search again'}]){
 const model=defer();let stream,calls=0;
 const s=await scenario({authorize:async()=>{calls++;return true;},generate:(_m,o)=>{stream=o.onDelta;return model.promise;}});
 const raw=JSON.stringify({...decision,...update});stream(raw);await settle();assert.equal(calls,0);
 model.resolve({text:raw});await settle();s.latest.resolve(result());await s.pending;
}
console.log('PASS overlapping permission, stale permission renewal, revocation and invalid assessment isolation');

{
 const model=defer(),gate=defer();let stream;
 const s=await scenario({authorize:()=>gate.promise,generate:(_messages,opts)=>{stream=opts.onDelta;return model.promise;}});
 stream(JSON.stringify(decision));await settle();model.resolve({text:'malformed final'});await settle();gate.resolve(true);await settle();
 assert.equal(s.events.length,0,'Late permission cannot revive a failed provisional generation');
 s.latest.resolve(result());await s.pending;assert.equal(s.events[0].type,'answer');
}
console.log('PASS permission completion cannot revive rejected provisional text');

{
 let tick=0,inputMessages;
 const s=await scenario({now:()=>at+tick++,generate:async(_messages,opts)=>{inputMessages=_messages;opts.onDelta?.(JSON.stringify(decision));return {text:JSON.stringify(decision),timing:{tokenMs:3,headersMs:4,streamFirstDeltaMs:2,streamCompleteMs:9,totalMs:13,privateText:'never expose',negative:-1}};}});
 s.latest.resolve(result());const out=await s.pending,t=out.provisionalTiming;
 assert.ok(t.firstSentenceMs>=0&&t.permissionStartedMs>=t.firstSentenceMs&&t.permissionMs>=0);
 assert.ok(t.modelFirstDeltaMs<=t.firstSentenceMs);
 assert.equal(t.provisionalInputBytes,Buffer.byteLength(JSON.stringify(inputMessages)));
 const input=JSON.parse(inputMessages[1].content);
 assert.equal(t.provisionalRecordCount,input.records.length);
 assert.equal(t.provisionalBodyChars,input.records.reduce((sum,r)=>sum+r.episode.content.length,0));
 assert.ok(Object.entries(t).filter(([key])=>['provisionalInputBytes','provisionalRecordCount','provisionalBodyChars','modelFirstDeltaMs'].includes(key)).every(([,value])=>Number.isFinite(value)));
 assert.ok(t.modelCompletedMs>=t.firstSentenceMs);assert.equal(t.provisionalTransport.privateText,undefined);
 assert.deepEqual(Object.keys(t.provisionalTransport),['tokenMs','headersMs','streamFirstDeltaMs','streamCompleteMs','totalMs']);
 assert.ok(Object.values(t.provisionalTransport).every(Number.isFinite),'Only numeric provider timing leaves server');
}
console.log('PASS sentence, permission and model completion clocks are distinct and numeric-only');

{
 let tick=0,latestDelta;const fresh=defer();
 const s=await scenario({now:()=>at+tick,verify:({onDelta})=>{latestDelta=onDelta;return fresh.promise;}});
 tick=100;latestDelta('');latestDelta(null);
 tick=200;latestDelta('担当は');tick=300;latestDelta('青山です。');
 assert.deepEqual(s.events.map(e=>e.type),['provisional'],'Latest draft stays private until verification');
 tick=900;fresh.resolve(result());const out=await s.pending;
 assert.equal(out.provisionalTiming.latestDraftFirstMs,200);
 assert.equal(out.provisionalTiming.latestDraftToVerificationMs,700);
 assert.ok(!JSON.stringify(out.provisionalTiming).includes('担当は'),'Diagnostics contain no draft text');
 assert.deepEqual(s.events.map(e=>e.type),['provisional','verified','done']);
 latestDelta('遅着');assert.equal(s.events.length,3,'Late draft cannot emit after completion');
 const absent=await scenario();absent.latest.resolve(result());const noDraft=await absent.pending;
 assert.equal(noDraft.provisionalTiming.latestDraftFirstMs,null);
 assert.equal(noDraft.provisionalTiming.latestDraftToVerificationMs,null);
}
console.log('PASS latest draft timing excludes empty/late chunks and keeps provisional verification gate');

// Latest continuation is pending, uses fresh full bodies and current permission,
// and cannot enter final history or be spoken twice before complete validation.
for(const mode of ['complete','text_changed','body_changed','source_removed','permission_revoked','error','cancelled']){
 let stream,tick=0;const fresh=defer(),gate=defer(),controller=new AbortController();let checks=0;
 const s=await scenario({now:()=>at+tick,signal:controller.signal,authorize:()=>++checks===2?gate.promise:Promise.resolve(mode!=='permission_revoked'||checks<3),verify:({onDelta})=>{stream=onDelta;return fresh.promise;}});
 const assessed=result(),full=decision.text+'窓口は開発室です。';
 tick=200;stream(decision.text+'窓口は',assessed);await settle();assert.equal(checks,1,'Incomplete sentence cannot start continuation permission');
 tick=300;stream('開発室です。',assessed);await settle();assert.equal(s.events.length,1,'Permission holds the latest continuation');
 gate.resolve(true);await settle();
 assert.equal(s.events[1].type,'supplement');assert.equal(s.events[1].verification,'pending');assert.match(s.events[1].replacementAnswer,/取得時点の暫定の要点/);assert.match(s.events[1].replacementAnswer,/補足（最終確認中）：窓口は開発室です。/);
 assert.equal(s.events[1].speechText,'最新取得した記録での補足です。窓口は開発室です。');
 if(mode==='cancelled'){
  controller.abort();await assert.rejects(s.pending,/中断/);const count=s.events.length;stream('遅着です。',assessed);fresh.resolve({...result(),answer:full});await settle();assert.equal(s.events.length,count);continue;
 }
 let final={...result(),answer:full,spokenAnswer:full};
 if(mode==='text_changed')final.answer=final.spokenAnswer=decision.text+'窓口は未確認です。';
 if(mode==='body_changed')final.evidence=result('変更された本文').evidence;
 if(mode==='source_removed')final.sources=[];
 tick=900;fresh.resolve(mode==='error'?{}:final);
 if(mode==='permission_revoked'||mode==='error'){
  await assert.rejects(s.pending);const last=s.events.at(-1);assert.equal(last.type,'correction');assert.equal(last.verification,'failed');assert.ok(!last.replacementAnswer.includes('窓口は開発室'));
 }else{
  const out=await s.pending;assert.equal(out.provisionalTiming.supplementFirstMs,300);assert.equal(out.provisionalTiming.verifiedMs,900);
  assert.equal(s.events.at(-2).type,mode==='complete'?'verified':'correction');
  assert.equal(s.events.filter(e=>e.type==='supplement').length,1,'No duplicate complete-answer continuation');
  assert.equal(out.answer,final.answer);
 }
}
for(const mode of ['no_contract','partial','changed','deleted','incomplete','wrong_scope','unknown','expired']){
 let stream,tick=0;const fresh=defer();
 const s=await scenario({now:()=>at+tick,verify:({onDelta})=>{stream=onDelta;return fresh.promise;}}),assessed=result();
 if(mode==='partial')assessed.evidenceStatus='partial';
 if(mode==='changed')assessed.evidence=result('変更本文').evidence;
 if(mode==='deleted')assessed.evidence[0].result.structuredContent.deleted=true;
 if(mode==='incomplete')assessed.evidence[0].result.structuredContent.coverage.complete=false;
 if(mode==='wrong_scope')assessed.evidence[0].result.structuredContent.episode.group_id='other';
 if(mode==='unknown')assessed.sources.push({uuid:'unknown'});
 if(mode==='expired')tick=700000;
 stream(decision.text+'窓口は開発室です。',mode==='no_contract'?undefined:assessed);await settle();
 assert.equal(s.events.length,1,mode+': no early latest supplement');fresh.resolve({...result(),answer:decision.text+'窓口は開発室です。'});await s.pending;
}
{
 let stream,tick=0,checks=0;const fresh=defer(),gate=defer();
 const s=await scenario({now:()=>at+tick,authorize:()=>++checks===3?gate.promise:Promise.resolve(true),verify:({onDelta})=>{stream=onDelta;return fresh.promise;}}),assessed=result();
 stream(decision.text+'窓口は開発室です。',assessed);await settle();assert.equal(s.events.length,2);
 tick=1501;stream('受付は平日です。',assessed);await settle();assert.equal(s.events.length,2,'Permission older than one second renewed before next sentence');
 gate.resolve(true);await settle();assert.equal(s.events[2].speechText,'受付は平日です。');
 fresh.resolve({...result(),answer:decision.text+'窓口は開発室です。受付は平日です。'});await s.pending;
 assert.equal(s.events.filter(e=>e.type==='supplement').length,2);
}
console.log('PASS pending fresh continuations, full evidence/current permission, renewal, withdrawal, correction and no repeated speech');
{
 let stream;const fresh=defer();
 const s=await scenario({verify:({onDelta})=>{stream=onDelta;return fresh.promise;}}),assessed=result();
 const second=structuredClone(assessed.evidence[0]);second.uuid=second.result.structuredContent.episode.uuid='continuation-source';second.result.structuredContent.episode.content='窓口は開発室。';
 assessed.evidence.push(second);assessed.sources.push({uuid:'continuation-source'});
 stream(decision.text+'窓口は開発室です。',assessed);await settle();assert.equal(s.events.at(-1).type,'supplement');
 const final=structuredClone(assessed);final.answer=final.spokenAnswer=decision.text+'窓口は開発室です。';final.evidence[1].result.structuredContent.episode.content='窓口は変更。';
 fresh.resolve(final);await s.pending;assert.equal(s.events.at(-2).type,'correction','Final comparison covers the continuation-only source as well as initial sources');
}

// Exact continuation still rechecks permission and remains cancellable.
for(const mode of ['allowed','revoked','cancelled']){
 const gate=defer(),controller=new AbortController();let calls=0;
 const s=await scenario({signal:controller.signal,authorize:()=>++calls===3?gate.promise:Promise.resolve(true)});
 const full=decision.text+'窓口は開発室です。';
 s.latest.resolve({...result(),answer:full,spokenAnswer:full});await settle();
 assert.equal(s.events.at(-1).type,'verified');
 assert.equal(s.events.filter(e=>e.type==='supplement').length,0,'Fresh permission gates the continuation');
 if(mode==='cancelled'){
  controller.abort();await assert.rejects(s.pending,/中断/);const count=s.events.length;
  gate.resolve(true);await settle();assert.equal(s.events.length,count,'Late permission cannot revive a cancelled continuation');
 }else{
  gate.resolve(mode==='allowed');
  if(mode==='revoked'){await assert.rejects(s.pending,/権限/);assert.equal(s.events.filter(e=>e.type==='supplement').length,0);}
  else{await s.pending;assert.equal(s.events.at(-2).speechText,'補足です。窓口は開発室です。');}
 }
}
console.log('PASS exact continuation permission, revocation, cancellation and late completion isolation');
// Permission transport failures must withdraw displayed claims, including after
// a pending supplement or a verified event waiting on remaining speech.
for(const stage of ['final','pending_final','remaining']){
 for(const failure of ['denied','reject','throw','unknown']){
  let calls=0,stream;const latest=defer(),failAt=stage==='final'?2:3;
  const s=await scenario({authorize:()=>{if(++calls!==failAt)return Promise.resolve(true);if(failure==='throw')throw new Error('catalog unavailable');if(failure==='reject')return Promise.reject(new Error('catalog unavailable'));return Promise.resolve(failure==='unknown'?{}:false);},verify:({onDelta})=>{stream=onDelta;return latest.promise;}});
  const full=decision.text+'窓口は開発室です。';
  if(stage==='pending_final'){stream(full,result());await settle();assert.equal(s.events.at(-1).type,'supplement');}
  latest.resolve({...result(),answer:full,spokenAnswer:full});
  await assert.rejects(s.pending,/権限/);
  const last=s.events.at(-1);assert.equal(last.type,'correction',stage+'/'+failure);assert.equal(last.verification,'failed');assert.deepEqual(last.sourceIds,[]);
  assert.ok(!last.replacementAnswer.includes('青山'));assert.ok(!last.replacementAnswer.includes('開発室'));assert.equal(s.events.filter(e=>e.type==='done').length,0);
 }
}
console.log('PASS final and remaining permission rejection, transport failure and unknown values withdraw all claims');
{
 let stream;const fresh=defer();const s=await scenario({getSnapshot:async()=>null,authorize:async()=>{throw new Error('catalog unavailable');},verify:({onDelta})=>{stream=onDelta;return fresh.promise;}});
 stream('担当は青山です。');await settle();assert.equal(s.events.at(-1).type,'delta');
 fresh.resolve(result());await assert.rejects(s.pending,/権限/);assert.equal(s.events.at(-1).type,'correction');assert.deepEqual(s.events.at(-1).sourceIds,[]);
}
{
 const gate=defer(),controller=new AbortController();let calls=0;
 const s=await scenario({signal:controller.signal,authorize:()=>++calls===2?gate.promise:Promise.resolve(true)});
 s.latest.resolve(result());await settle();controller.abort();await assert.rejects(s.pending,/中断/);const count=s.events.length;
 gate.resolve(true);await settle();assert.equal(s.events.length,count,'Late final catalog permission cannot revive a cancelled answer');
}
{
 let readInitial,calls=0;const sLatest=defer();
 const s=await scenario({verify:({getProvisionalAnswer})=>{readInitial=getProvisionalAnswer;assert.equal(readInitial(),null);return sLatest.promise;},generate:async()=>{calls++;return {text:JSON.stringify(decision)};}});
 assert.deepEqual(readInitial(),{text:decision.text,sourceIds:[episode.uuid]});
 const copy=readInitial();copy.sourceIds.push('other');assert.deepEqual(readInitial().sourceIds,[episode.uuid]);
 sLatest.resolve({...result(),answer:decision.text+'窓口は開発室です。',spokenAnswer:decision.text+'窓口は開発室です。'});
 await s.pending;assert.equal(calls,1,'Exact fresh continuation avoids the second model');assert.equal(readInitial(),null,'Completed request cannot supply a stale provisional');
}
{
 const before=Date.parse('2026-10-09T23:59:59+09:00'),after=before+2000;
 const dailySnapshot={...structuredClone(snapshot),checkedAt:before,records:[
  {episode:{...episode,uuid:'oct8'},addedAt:'2026-10-08T12:00:00+09:00',fetchedAt:before},
  {episode:{...episode,uuid:'oct9'},addedAt:'2026-10-09T12:00:00+09:00',fetchedAt:before}
 ]};
 assert.deepEqual(selectPrefetchedRecords(dailySnapshot,'昨日の追加情報を教えて',{at:before}).map(r=>r.episode.uuid),['oct8']);
 assert.deepEqual(selectPrefetchedRecords(dailySnapshot,'昨日の追加情報を教えて',{at:after}).map(r=>r.episode.uuid),['oct9']);
 let tick=before,payload;
 const s=await scenario({question:'昨日の追加情報を教えて',now:()=>tick,getSnapshot:async()=>{tick=after;return dailySnapshot;},generate:async messages=>{payload=JSON.parse(messages[1].content);return {text:JSON.stringify({...decision,sourceIds:['oct8']})};}});
 assert.equal(payload.additionDate,'2026-10-08');assert.equal(payload.now,new Date(before).toISOString());
 assert.deepEqual(payload.records.map(r=>r.episode.uuid),['oct8'],'snapshot delay across midnight cannot change the requested day');
 assert.equal(s.events[0].type,'provisional');s.latest.resolve(result());await s.pending;
}
console.log('PASS request date remains fixed across Japan midnight while freshness uses the live clock');

{
 const history=[{question:'架空会社について教えて',answer:'これは根拠に使わない前の回答',synapseRead:true}];
 assert.equal(prefetchTopicQuestion('もっと詳しく教えてください。',history),history[0].question);
 assert.equal(prefetchTopicQuestion('それについて詳しく教えて',[...history,{question:'もっと詳しく',synapseRead:true}]),history[0].question);
 for(const turns of [[],[{...history[0],synapseRead:false}],[...history,{question:'別の話をしよう',synapseRead:false}],[{question:'昨日の情報を教えて',synapseRead:true}]])assert.equal(prefetchTopicQuestion('もっと詳しく教えて',turns),null);
 for(const q of ['それは？','それを送信して','別会社について詳しく教えて'])assert.equal(prefetchTopicQuestion(q,history),null);
 assert.equal(selectPrefetchedRecords(snapshot,'もっと詳しく教えて',{context:history}).length,1);
 let payload;const s=await scenario({question:'もっと詳しく教えて',context:history,generate:async messages=>{payload=JSON.parse(messages.at(-1).content);return {text:JSON.stringify(decision)};}});
 assert.equal(payload.question,'もっと詳しく教えて');assert.equal(payload.topicQuestion,history[0].question);
 assert.ok(!JSON.stringify(payload).includes(history[0].answer),'Prior answer is not factual evidence');
 assert.equal(s.events[0].type,'provisional','Detail can start while new verification is pending');
 s.latest.resolve(result());const out=await s.pending;assert.equal(out.synapseRead,true);assert.equal(out.provisionalUsed,true);
 const fallback=await scenario({question:'もっと詳しく教えて',context:[{...history[0],synapseRead:false}],generate:async()=>{throw Error('No speculative model call');}});assert.equal(fallback.events.length,0);fallback.latest.resolve(result());assert.equal((await fallback.pending).provisionalUsed,false);
}
console.log('Provisional detail follow-ups: user topic only, fresh verification, narrow fallback passed');

{
 const spellings={...snapshot,records:[{...snapshot.records[0],episode:{...episode,name:'SynapseConnect',content:'SynapseConnectの仕様を検証した保存本文。'}}]};
 for(const name of ['Synapse Connect','synapse connect','Ｓｙｎａｐｓｅ　Ｃｏｎｎｅｃｔ','SynapseConnect'])assert.equal(selectPrefetchedRecords(spellings,name+'について教えて').length,1);
 assert.equal(selectPrefetchedRecords(spellings,'Synapse別会社について教えて').length,0);
 assert.equal(selectPrefetchedRecords(spellings,'Ａ　について教えて').length,0,'Do not broaden a one-character normalized subject');
 const copied=structuredClone(spellings);selectPrefetchedRecords(spellings,'synapse connectについて教えて');assert.deepEqual(spellings,copied,'Matching must not change evidence or provenance');
 assert.equal(selectPrefetchedRecords(spellings,'もっと詳しく教えて',{context:[{question:'Ｓｙｎａｐｓｅ　Ｃｏｎｎｅｃｔについて教えて',synapseRead:true}]}).length,1);
 let payload;const s=await scenario({question:'Synapse Connectについて教えて',getSnapshot:async()=>spellings,generate:async messages=>{payload=JSON.parse(messages.at(-1).content);return {text:JSON.stringify(decision)};}});
 assert.equal(payload.question,'Synapse Connectについて教えて');assert.equal(payload.records[0].episode.content,spellings.records[0].episode.content);
 s.latest.resolve(result());await s.pending;
}
console.log('Prefetch spelling variants select candidates without rewriting evidence passed');

// Long bodies use explicit excerpt objects; count actual transmitted text only.
{
 const longSnapshot=structuredClone(snapshot);longSnapshot.records[0].episode.content='架空会社の担当は青山。'.repeat(800);
 let sent;const s=await scenario({getSnapshot:async()=>longSnapshot,generate:async messages=>{sent=JSON.parse(messages[1].content);return {text:JSON.stringify(decision)};}});
 s.latest.resolve(result(longSnapshot.records[0].episode.content));const out=await s.pending;
 const body=sent.records[0].episode.content;assert.equal(body.representation,'selected_excerpts');
 assert.equal(out.provisionalTiming.provisionalBodyChars,body.excerpts.reduce((n,e)=>n+e.text.length,0));
 assert.ok(out.provisionalTiming.provisionalBodyChars>0&&out.provisionalTiming.provisionalBodyChars<body.originalChars);
 assert.equal(out.provisionalTiming.modelFirstDeltaMs,null,'No provider callback is unmeasured, not zero');
 assert.ok(!JSON.stringify(out.provisionalTiming).includes('架空会社'));
}
console.log('PASS excerpt object character count, absent first delta and source-free diagnostics');

// An interrupted first sentence still carries its retrieval time and partial scope.
{
 const checked=Date.parse('2026-10-09T15:00:00Z'),dated=structuredClone(snapshot);
 dated.checkedAt=checked;dated.records.forEach(r=>r.fetchedAt=checked);
 const model=defer();let stream;
 const s=await scenario({now:()=>checked+1000,getSnapshot:async()=>dated,generate:(_m,o)=>{stream=o.onDelta;return model.promise;}});
 stream(JSON.stringify(decision).slice(0,-2));await settle();
 assert.match(s.events[0].speechText,/^10月10日0時00分取得の、一部の記録による暫定ですが、/);
 assert.equal(s.events[0].verification,'pending');
 model.resolve({text:JSON.stringify(decision)});await settle();
 assert.ok(!s.events[1].speechText.includes('10月10日'),'Do not repeat the retrieval time');
 s.latest.resolve(result());await s.pending;
}
console.log('PASS first spoken sentence carries Japan retrieval time, partial scope and pending status');

// The request suffix must not hide subject-bearing paragraphs in long bodies.
for(const request of ['架空会社について教えて','もっと詳しく教えて','架空会社の注意点を教えて']){
 const long=structuredClone(snapshot);
 const middle='架空会社の担当は青山。';
 long.records[0].episode.content='別の説明。'.repeat(1000)+middle+'関係のない末尾。'.repeat(1000);
 let sent;const question=request;
 const s=await scenario({question,context:request==='もっと詳しく教えて'?[{question:'架空会社について教えて',synapseRead:true}]:[],getSnapshot:async()=>long,generate:async messages=>{sent=JSON.parse(messages[1].content);return {text:JSON.stringify(decision)};}});
 assert.equal(sent.question,question);
 const body=sent.records[0].episode.content;
 assert.equal(body.representation,'selected_excerpts');
 assert.ok(body.excerpts.some(e=>e.text.includes(middle)),'Locate the subject paragraph beyond the beginning and tail');
 for(const e of body.excerpts)assert.equal(e.text,long.records[0].episode.content.slice(e.start,e.end),'Keep original characters and offsets');
 assert.equal(body.omitted,true);
 s.latest.resolve(result(long.records[0].episode.content));await s.pending;
}
console.log('PASS explicit and detail topics locate original middle paragraphs without request suffix');

// Candidate spelling matches must also locate the original paragraph.
for(const [topic,spelling] of [['Alpha Company','ＡＬＰＨＡ　ＣＯＭＰＡＮＹ'],['株式会社ガイド','株式会社ｶﾞｲﾄﾞ'],['Café','CAFÉ'],['Office Company','Oﬃce\nCompany']]){
 const long=structuredClone(snapshot),middle=spelling+'の担当は青山。';
 long.records[0].episode.name=spelling;
 long.records[0].episode.content='🙂㍿別の説明。'.repeat(1000)+middle+'無関係な末尾。'.repeat(1000);
 let sent;const question=topic+'について教えて';
 const s=await scenario({question,getSnapshot:async()=>long,generate:async messages=>{sent=JSON.parse(messages[1].content);return {text:JSON.stringify(decision)};}});
 assert.equal(sent.question,question);
 const body=sent.records[0].episode.content;
 assert.ok(body.excerpts.some(e=>e.text.includes(middle)),'Spelling variant must reach model in its original form');
 for(const e of body.excerpts)assert.equal(e.text,long.records[0].episode.content.slice(e.start,e.end));
 assert.ok(body.excerpts.reduce((n,e)=>n+e.text.length,0)<=4000);
 s.latest.resolve(result(long.records[0].episode.content));await s.pending;
}
console.log('PASS width, case and combining spelling variants retain original excerpt offsets');

// Repeated generic words must not consume the subject-location budget.
for(const spelling of ['Alpha Company','ＡＬＰＨＡ　ＣＯＭＰＡＮＹ']){
 const long=structuredClone(snapshot),middle=spelling+'の担当は青山。';
 long.records[0].episode.name=spelling;
 long.records[0].episode.content='無関係な説明。'.repeat(600)+middle+'Company別件。'.repeat(250)+'無関係な末尾。'.repeat(600);
 let sent;
 const s=await scenario({question:'Alpha Companyについて教えて',getSnapshot:async()=>long,generate:async messages=>{sent=JSON.parse(messages[1].content);return {text:JSON.stringify(decision)};}});
 const body=sent.records[0].episode.content;
 assert.ok(body.excerpts.some(e=>e.text.includes(middle)),'Full subject survives more than 100 unrelated term matches');
 for(const e of body.excerpts)assert.equal(e.text,long.records[0].episode.content.slice(e.start,e.end));
 assert.ok(body.excerpts.reduce((n,e)=>n+e.text.length,0)<=4000);
 s.latest.resolve(result(long.records[0].episode.content));await s.pending;
}
console.log('PASS exact and spelling-variant subjects survive generic-term saturation');

{
 const mentions=Array.from({length:12},(_,i)=>({...snapshot.records[0],episode:{...episode,uuid:'incidental-'+i,name:'開発メモ',content:'架空会社の調査を続ける。'}}));
 const preferred={...snapshot.records[0],episode:{...episode,uuid:'verified-older'}};
 const candidates={...snapshot,records:[...mentions,preferred],preferredIds:[preferred.episode.uuid]};
 assert.equal(selectPrefetchedRecords(candidates,'架空会社について教えて')[0].episode.uuid,'verified-older');
 assert.equal(selectPrefetchedRecords(candidates,'別会社について教えて').length,0,'Preferred source still must match the topic');
 assert.equal(selectPrefetchedRecords(candidates,'架空会社について教えて').length,1);
 assert.equal(selectPrefetchedRecords(candidates,'もっと詳しく教えて',{context:[{question:'架空会社について教えて',synapseRead:true}]}).length,1);
 const title={...preferred,episode:{...preferred.episode,uuid:'topic-title'}};
 assert.equal(selectPrefetchedRecords({...candidates,records:[...mentions,title],preferredIds:[]},'架空会社について教えて')[0].episode.uuid,'topic-title');
 assert.equal(selectPrefetchedRecords({...candidates,records:mentions,preferredIds:[]},'架空会社について教えて').length,8,'Body-only fallback remains bounded when no focused candidate exists');
}
console.log('PASS preferred full source wins candidate slots without bypassing topic matching');
