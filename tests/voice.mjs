import assert from 'node:assert/strict';
import {VoiceConversation} from '../public/voice.js';
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
console.log('PASS voice turn-taking, interruption, context, permission failure, and late-response suppression');
