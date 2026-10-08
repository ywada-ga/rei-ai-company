import assert from 'node:assert/strict';
import {streamedAnswerPrefix,converse} from '../conversation.mjs';
import {readResponseStream} from '../chatgpt-plan.mjs';
import {readConversationStream} from '../public/conversation-stream.js';
import {createLocalSpeechStream,createConversationSpeech} from '../public/local-voice.js';
import {VoiceConversation,createTurnLatency} from '../public/voice.js';
const encoder=new TextEncoder();
const answer=JSON.stringify({decision:{action:'answer',text:'こんにちは。\n"確認"😀'}});
let previous='';for(let i=1;i<=answer.length;i++){const text=streamedAnswerPrefix(answer.slice(0,i));assert.ok(text.startsWith(previous));previous=text;}assert.equal(previous,'こんにちは。\n"確認"😀');
assert.equal(streamedAnswerPrefix('{"decision":{"action":"search","query":"secret"'), '');
let complete=false,deltas=[];
const response=new Response(new ReadableStream({start(c){c.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"first"}\n\n'));setTimeout(()=>{complete=true;c.enqueue(encoder.encode('data: {"type":"response.completed"}\n\n'));c.close();},10);}}));
await readResponseStream(response,{onDelta:text=>{assert.equal(complete,false);deltas.push(text);}});assert.deepEqual(deltas,['first']);
const events=[];let sourceRead=false;
const result=await converse({question:'会社の予定は？',groups:[{id:'g',name:'共有'}],onDelta:text=>{assert.equal(sourceRead,true);events.push(text);},generate:async(messages,{onDelta,phase})=>{
 if(phase==='evidence_answer'){const raw=JSON.stringify({action:'respond',status:'supported',sourceIds:['fact'],reason:'',query:'',text:'確認済みです。'});for(let i=1;i<=raw.length;i++)onDelta?.(raw.slice(0,i));return {text:raw};}
 if(!sourceRead){onDelta?.('{"decision":{"action":"answer","text":"未検証"}}');return {text:'{"action":"search","query":"予定"}'};}
 const raw='{"decision":{"action":"answer","text":"確認した予定です。"}}';for(let i=1;i<=raw.length;i++)onDelta?.(raw.slice(0,i));return {text:raw};
},call:async tool=>{if(tool==='get_fact_source'){sourceRead=true;return {structuredContent:{sources:[{traceable:true,group_id:"g",body:"確認する本文"}]}};}return {structuredContent:{facts:[{uuid:'fact',group_id:'g',fact:'予定'}]}};},submit:()=>{throw Error('no work')}});
assert.equal(events.join(''),result.answer);
const lines=[{type:'delta',text:'途中。'},{type:'done',result:{answer:'途中。完了。'}}].map(e=>JSON.stringify(e)+'\n').join('');
const pieces=[];const stream=new Response(new ReadableStream({start(c){const bytes=encoder.encode(lines);for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}}));assert.equal((await readConversationStream(stream,{onDelta:t=>pieces.push(t)})).answer,'途中。完了。');assert.deepEqual(pieces,['途中。']);
await assert.rejects(readConversationStream(new Response('{"type":"delta","text":"途中"}\n')),/途中で/);
await assert.rejects(readConversationStream(new Response('{"type":"error","message":"失敗"}\n')),/失敗/);
let audioPlayed=[],prepared=[];let endFirst;const urls={createObjectURL:()=>String(prepared.length),revokeObjectURL(){}};
class AudioMock{constructor(url){this.url=url;}pause(){}removeAttribute(){}play(){audioPlayed.push(this.url);if(audioPlayed.length===1)endFirst=()=>this.onended?.();else queueMicrotask(()=>this.onended?.());return Promise.resolve();}}
const speech=createLocalSpeechStream(new AbortController().signal,async(url,opts)=>{prepared.push(JSON.parse(opts.body).text);return {wav:btoa('RIFF')};},{AudioClass:AudioMock,urls});
speech.push('最初の文。');await new Promise(r=>setTimeout(r,0));assert.equal(audioPlayed.length,1,'play starts before completion');speech.push('次の文。');await new Promise(r=>setTimeout(r,0));assert.equal(prepared.length,2,'next audio prepares during playback');assert.equal(audioPlayed.length,1);const finished=speech.finish('最初の文。次の文。');endFirst();await finished;assert.equal(audioPlayed.length,2);
const changes=[];let resolveFinal,spokenParts=[];
const voice=new VoiceConversation({Recognition:class{},ask:async(q,c,s,onDelta,onReceipt)=>{onReceipt('受け答えだけです。');assert.equal(changes.at(-1).message,'受け答えだけです。');assert.equal(changes.at(-1).latency.firstTextMs,null);onDelta('こんにちは。');return new Promise(r=>resolveFinal=r);},onChange:s=>changes.push(s)});
voice.streamReply=(signal,onPlaying)=>({push(t){spokenParts.push(t);onPlaying();},async finish(){},cancel(){}});voice.active=true;voice.epoch=1;voice.listen=()=>{voice.phase='listening';};const responding=voice.respond('こんにちは',1);assert.deepEqual(spokenParts,['こんにちは。']);assert.equal(voice.history.length,0);resolveFinal('こんにちは。');await responding;assert.equal(voice.history.length,1);assert.equal(voice.phase,'listening');voice.stop();
console.log('incremental decoding, source gate, transport completion, ordered audio and continuous voice passed');

let time=1100;const measured=createTurnLatency(()=>time,1000);measured.text(' ');assert.equal(measured.snapshot().firstTextMs,null);time=1250;measured.text('回答');time=1600;measured.audio();time=2000;measured.audio();measured.complete();assert.deepEqual(measured.snapshot(),{anchor:'speech_end',firstTextMs:250,firstAudioMs:600,textCompleteMs:1000});
const fallback=createTurnLatency(()=>time);assert.equal(fallback.snapshot().anchor,'request_start');
let started=0,rejectPlay;class BlockedAudio{pause(){}removeAttribute(){}play(){return new Promise((resolve,reject)=>rejectPlay=reject);}}
const blocked=createLocalSpeechStream(new AbortController().signal,async()=>({wav:btoa('RIFF')}),{AudioClass:BlockedAudio,urls,onPlaying(){started++;}});blocked.push('試験。');await new Promise(r=>setTimeout(r,0));assert.equal(started,0,'synthesis is not audio onset');rejectPlay(new Error('blocked'));await assert.rejects(blocked.finish('試験。'),/blocked/);assert.equal(started,0);
console.log('speech-end timing, request-start fallback and rejected playback onset passed');

let preparation;const diagnostic=createLocalSpeechStream(new AbortController().signal,async()=>({wav:btoa('RIFF'),preparationMs:7,firstGeneratedSeconds:0.4,totalSeconds:1}),{AudioClass:AudioMock,urls,onPrepared(value){preparation=value;}});diagnostic.push('一文。');await new Promise(r=>setTimeout(r,0));assert.deepEqual(preparation,{characters:3,preparationMs:7,firstGeneratedSeconds:0.4,totalSeconds:1});const diagnosticDone=diagnostic.finish('一文。');await diagnosticDone;assert.ok(!('wav' in preparation));console.log('synthesis timing exposes numbers without audio or text');

const {conversationReceipt}=await import('../conversation.mjs');
assert.equal(conversationReceipt('グレイトフルグループについて教えてください！'),'グレイトフルグループについてですね。まず概要から確認します。');
assert.equal(conversationReceipt('グレイトフルグループの売上はいくら？'),null);
assert.equal(conversationReceipt('こんにちは'),null);
const receipts=[],answerDeltas=[];const receiptTiming=createTurnLatency(()=>1000);
const receiptEvents=[{type:'receipt',text:'まず概要から確認します。'},{type:'delta',text:'確認済みの回答です。'},{type:'done',result:{answer:'確認済みの回答です。'}}];
await readConversationStream(new Response(receiptEvents.map(x=>JSON.stringify(x)+'\n').join('')),{onReceipt:text=>{receipts.push(text);assert.equal(receiptTiming.snapshot().firstTextMs,null);},onDelta:text=>{answerDeltas.push(text);receiptTiming.text(text);}});
assert.deepEqual(receipts,['まず概要から確認します。']);assert.deepEqual(answerDeltas,['確認済みの回答です。']);
console.log('receipt channel stays separate from meaningful answer deltas and latency');

const order=[];let finishReceipt,answerOnset=0,receiptOnset=0;
const gated=createConversationSpeech(new AbortController().signal,options=>{
 const number=order.filter(x=>x==='create').length;order.push('create');
 let played=Promise.resolve();return {push(text){order.push(text);options.onPrepared?.();played=Promise.resolve(options.playbackReady).then(()=>options.onPlaying?.());},finish(){return number===0?new Promise(r=>finishReceipt=r):played;},cancel(){order.push('cancel');}};
},{onPlaying(){answerOnset++;},onReceiptPlaying(){receiptOnset++;}});
gated.receipt('受け答え。');await Promise.resolve();gated.push('回答。');assert.equal(receiptOnset,1);assert.equal(answerOnset,0);assert.deepEqual(order,['create','はい。','create','回答。'],'answer prepares during receipt playback');
finishReceipt();await gated.finish('回答。');assert.equal(answerOnset,1);assert.deepEqual(order,['create','はい。','create','回答。']);
gated.receipt('遅い受け答え。');assert.ok(!order.includes('遅い受け答え。'));
const cancelSignal=new AbortController();let releaseCanceled;const canceledOrder=[];
const canceledSpeech=createConversationSpeech(cancelSignal.signal,()=>({push(t){canceledOrder.push(t);},finish(){return new Promise(r=>releaseCanceled=r);},cancel(){canceledOrder.push('cancel');}}));
canceledSpeech.receipt('案内。');canceledSpeech.push('中断後は流さない。');cancelSignal.abort();releaseCanceled();await assert.rejects(canceledSpeech.finish('中断後は流さない。'),/中断/);assert.deepEqual(canceledOrder,['はい。','中断後は流さない。','cancel','cancel']);
console.log('Qwen receipt and answer playback remain ordered, separately timed and canceled together');

let failedCount=0;const afterFailure=[];
const failedReceipt=createConversationSpeech(new AbortController().signal,()=>{
 const receipt=failedCount++===0;return {push(t){afterFailure.push(t);},finish(){return receipt?Promise.reject(Error('receipt playback failed')):Promise.resolve();},cancel(){}};
});
failedReceipt.receipt('案内。');failedReceipt.push('本回答。');await failedReceipt.finish('本回答。');assert.deepEqual(afterFailure,['はい。','本回答。']);
console.log('failed receipt playback does not discard the verified answer');

const failureDiagnostics={failure:'model',totalMs:120,stages:[{kind:'model',startMs:0,durationMs:120,failed:true}]};
await assert.rejects(readConversationStream(new Response(JSON.stringify({type:'error',message:'回答を完了できませんでした',diagnostics:failureDiagnostics})+'\n')),error=>{
 assert.deepEqual(error.conversationDiagnostics,failureDiagnostics);return true;
});
console.log('PASS streaming failure diagnostics reach the UI without pretending that an answer completed');
const progressOnly=[],answerOnly=[];
await readConversationStream(new Response([
 {type:'progress',stage:'source',text:'資料の本文を確認しています。'},
 {type:'delta',text:'確認した回答です。'},
 {type:'done',result:{answer:'確認した回答です。'}}
].map(e=>JSON.stringify(e)+'\n').join('')),{onReceipt:(text,notice)=>progressOnly.push({text,notice}),onDelta:t=>answerOnly.push(t)});
assert.equal(progressOnly[0].notice.type,'progress');assert.deepEqual(answerOnly,['確認した回答です。']);
await assert.rejects(readConversationStream(new Response(JSON.stringify({type:'progress',stage:'source',text:'社内の事実を捏造した案内'})+'\n')),/進捗/);
const priority=[],progressHandle={push(t){priority.push(t);},finish(){return new Promise(()=>{});},cancel(){priority.push('notice-stopped');}};
let creations=0;
const prioritySpeech=createConversationSpeech(new AbortController().signal,options=>{
 if(++creations===1){options.onPrepared?.({});return progressHandle;}
 return {push(t){priority.push(t);},async finish(){await options.synthesisReady;await options.playbackReady;options.onPlaying?.();},cancel(){}};
});
prioritySpeech.progress('資料の本文を確認しています。');prioritySpeech.push('回答です。');await prioritySpeech.finish('回答です。');
assert.deepEqual(priority,['資料の本文を確認しています。','回答です。','notice-stopped']);prioritySpeech.progress('関連する記録を探しています。');assert.equal(creations,2);
console.log('PASS validated progress stays separate; answer interrupts notice playback without waiting for it to finish');
let spokenFinal='';const visibleAnswer='確認した回答です。\n\n出どころ：画面だけに表示する資料。';
const citedVoice=new VoiceConversation({Recognition:class{},ask:async(q,c,s,onDelta)=>{onDelta('確認した回答です。');return {answer:visibleAnswer,spokenAnswer:'確認した回答です。'};}});
citedVoice.streamReply=()=>({push(){},async finish(text){spokenFinal=text;},cancel(){}});citedVoice.active=true;citedVoice.epoch=1;citedVoice.listen=()=>{citedVoice.phase='listening';};
await citedVoice.respond('試験',1);assert.equal(spokenFinal,'確認した回答です。');assert.equal(citedVoice.history[0].answer,visibleAnswer);citedVoice.stop();
console.log('PASS source lists remain visible in history but are not added to answer speech');
