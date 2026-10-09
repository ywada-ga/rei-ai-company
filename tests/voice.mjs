import assert from 'node:assert/strict';
import {VoiceConversation,spokenText,speechChunks,japaneseVoice} from '../public/voice.js';
assert.deepEqual(speechChunks('予定は金曜日です。資料を先に準備しましょう。'),['予定は金曜日です。資料を先に準備しましょう。']);
assert.equal(spokenText('予定は金曜日です。（記録ID: 7bb431f2-fe67-4490-9e66-bdf18c7c1f6b）'),'予定は金曜日です。');
assert.equal(spokenText('費用は12,000円、期限は10/16です。'),'費用は12,000円、期限は10/16です。');
const longSpeech='前半です。'+'準備、'.repeat(170)+'終わりです。';assert.equal(speechChunks(longSpeech).join(''),longSpeech);assert.ok(speechChunks(longSpeech).every(chunk=>Array.from(chunk).length<=380));
assert.equal(japaneseVoice([{lang:'en-US',voiceURI:'en',default:true},{lang:'ja-JP',voiceURI:'ja'}]).voiceURI,'ja');
assert.equal(japaneseVoice([{lang:'ja-JP',voiceURI:'one'},{lang:'ja-JP',voiceURI:'two',default:true}],'one').voiceURI,'one');
const recordings=[],spoken=[];
class Recognition{constructor(){recordings.push(this);}start(){this.started=true;}abort(){this.aborted=true;}}
class Utterance{constructor(text){this.text=text;}}
const synthesis={speak:utterance=>spoken.push(utterance),cancel(){this.cancelled=true;},getVoices:()=>[{lang:'ja-JP'}]};
let calls=0,contexts=[],resolveAnswer;
const changes=[];
const voice=new VoiceConversation({Recognition,Utterance,synthesis,restartDelay:1,onChange:x=>changes.push(x),ask:async(question,context,signal)=>{calls++;contexts.push(context);assert.equal(signal.aborted,false);return new Promise(resolve=>resolveAnswer=resolve);}});
voice.start();const first=recordings.at(-1);assert.equal(first.started,true);assert.equal(voice.phase,'listening');
const result=[{transcript:'会社の予定を教えて'}];result.isFinal=true;
first.onresult({results:[result]});first.onresult({results:[result]});first.onend();first.onend();
assert.equal(calls,1);assert.equal(voice.phase,'thinking');
resolveAnswer('決定を確認しました。次の準備があります。');await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(voice.phase,'speaking');assert.equal(recordings.length,1);
const oldUtterance=spoken.at(-1);voice.interrupt();assert.equal(voice.phase,'listening');assert.equal(recordings.length,2);
oldUtterance.onend();assert.equal(recordings.length,2,'cancelled speech must not start another microphone');
const second=recordings.at(-1);second.onresult({results:[result]});second.onend();assert.equal(contexts[1].length,1);assert.equal(contexts[1][0].question,'会社の予定を教えて');
const beforeStop=spoken.length;voice.stop();resolveAnswer('遅い回答');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(spoken.length,beforeStop);assert.equal(voice.active,false);assert.equal(voice.phase,'idle');
voice.start();recordings.at(-1).onerror({error:'not-allowed'});assert.equal(voice.active,false);assert.equal(voice.phase,'error');assert.match(changes.at(-1).message,/マイク/);
const complete=new VoiceConversation({Recognition,Utterance,synthesis,ask:async()=> '回答です。',onChange:()=>{}});complete.start();const rec=recordings.at(-1);rec.onresult({results:[result]});rec.onend();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(complete.phase,'speaking');spoken.at(-1).onend();assert.equal(complete.phase,'listening');complete.stop();
voice.start();const ending=recordings.at(-1),endResult=[{transcript:'会話を終了して'}];endResult.isFinal=true;const callsBeforeEnd=calls;ending.onresult({results:[endResult]});ending.onend();assert.equal(voice.active,false);assert.equal(calls,callsBeforeEnd);
assert.throws(()=>new VoiceConversation({Recognition:null,synthesis:null,Utterance:null,ask:()=>{}}).start(),/Chrome/);
let timedOutSignal,late;
const bounded=new VoiceConversation({Recognition,Utterance,synthesis,answerTimeoutMs:15,ask:async(q,c,signal)=>{timedOutSignal=signal;return new Promise(resolve=>late=resolve);}});
bounded.start();const boundedRec=recordings.at(-1);boundedRec.onresult({results:[result]});boundedRec.onend();
await new Promise(resolve=>setTimeout(resolve,25));assert.equal(bounded.active,false);assert.equal(bounded.phase,'error');assert.equal(timedOutSignal.aborted,true);
const previousLate=late;
bounded.start();const restarted=recordings.at(-1);restarted.onresult({results:[result]});restarted.onend();
const spokenAtTimeout=spoken.length;
previousLate('期限後の回答');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(spoken.length,spokenAtTimeout);
await new Promise(resolve=>setTimeout(resolve,25));assert.equal(bounded.phase,'error','an old answer must not clear the next turn deadline');
late('次の期限後の回答');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(spoken.length,spokenAtTimeout);
// Interrupt an unresolved streamed request, then deliver stale events after a new turn.
const requests=[],streams=[];
const interrupted=new VoiceConversation({Recognition,Utterance,synthesis,answerTimeoutMs:30,
  ask:(question,context,signal,delta,receipt)=>new Promise(resolve=>requests.push({signal,delta,receipt,resolve})),
});
interrupted.streamReply=(signal,onPlaying)=>{
  const stream={chunks:[],cancelled:false,push(text){this.chunks.push(text);},receipt(){},progress(){},finish:async()=>{},cancel(){this.cancelled=true;},onPlaying};
  signal.addEventListener('abort',()=>stream.cancel(),{once:true});streams.push(stream);return stream;
};
interrupted.start();assert.equal(interrupted.canInterrupt,false);
let input=recordings.at(-1);input.onresult({results:[result]});input.onend();
assert.equal(interrupted.canInterrupt,true);const oldRequest=requests[0];
interrupted.interrupt();assert.equal(oldRequest.signal.aborted,true);assert.equal(streams[0].cancelled,true);
assert.equal(interrupted.phase,'listening');assert.equal(interrupted.canInterrupt,false);
await new Promise(resolve=>setTimeout(resolve,40));
assert.equal(interrupted.active,true,'interrupted request deadline must be cleared even if ask ignores abort');
input=recordings.at(-1);input.onresult({results:[result]});input.onend();
oldRequest.delta('旧回答');oldRequest.receipt('旧進捗');streams[0].onPlaying();oldRequest.resolve('旧最終回答');
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(interrupted.phase,'thinking');assert.equal(interrupted.answer,'');assert.equal(interrupted.history.length,0);
assert.deepEqual(streams[0].chunks,[],'stale deltas must not feed audio');
await new Promise(resolve=>setTimeout(resolve,40));
assert.equal(interrupted.phase,'error','old finally must not clear new request deadline');
assert.equal(requests[1].signal.aborted,true);requests[1].resolve('期限後');
await new Promise(resolve=>setTimeout(resolve,0));assert.equal(interrupted.history.length,0);
console.log('PASS voice turn-taking, thinking/speaking interruption, context, permission failure, and late-response suppression');
