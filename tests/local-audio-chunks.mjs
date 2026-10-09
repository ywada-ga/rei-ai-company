import assert from 'node:assert/strict';
import {createLocalSpeechStream,createConversationSpeech} from '../public/local-voice.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let sources=[];
const context={currentTime:0,state:'running',destination:{},resume:async()=>{},decodeAudioData:async()=>({duration:.5}),createBufferSource(){const source={connect(){},disconnect(){},start(at){this.at=at;sources.push(this);},stop(){this.stopped=true;this.onended?.();}};return source;}};
const wav=btoa('RIFF');let streamControl;
const streamRequest=async()=>new Response(new ReadableStream({start(c){streamControl=c;c.enqueue(new TextEncoder().encode(JSON.stringify({type:'chunk',index:0,wav})+'\n'));}}));
let controller=new AbortController();
const speech=createLocalSpeechStream(controller.signal,()=>{throw new Error('old endpoint used');},{context,streamRequest});
speech.push('最初の文です。');await tick();await tick();
assert.equal(sources.length,1,'first audio starts before stream completion');
streamControl.enqueue(new TextEncoder().encode(JSON.stringify({type:'chunk',index:1,wav})+'\n'));
await tick();assert.equal(sources[1].at,sources[0].at+.5,'chunks share a gapless scheduled timeline');
streamControl.enqueue(new TextEncoder().encode(JSON.stringify({type:'done',chunkCount:2})+'\n'));streamControl.close();
let finished=false;const completion=speech.finish('最初の文です。').then(()=>finished=true);await tick();assert.equal(finished,false,'wait for actual audio completion');
for(const source of sources)source.onended();await completion;
sources=[];controller=new AbortController();
const cancelled=createLocalSpeechStream(controller.signal,()=>{}, {context,streamRequest});cancelled.push('中断します。');await tick();cancelled.cancel();
assert.equal(sources.length,1);await assert.rejects(cancelled.finish('中断します。'),/中断/);streamControl.close();
controller=new AbortController();
const incomplete=createLocalSpeechStream(controller.signal,()=>{}, {context,streamRequest:async()=>new Response(JSON.stringify({type:'chunk',index:2,wav})+'\n')});
incomplete.push('不正です。');await tick();await assert.rejects(incomplete.finish('不正です。'));
console.log('PASS early chunk playback, continuous timeline, completion, cancellation and invalid ordering');
// Preparing answer audio may start after receipt generation, while its playback waits.
sources=[];controller=new AbortController();let releaseGeneration,releasePlayback,requests=0;
const synthesisReady=new Promise(r=>releaseGeneration=r),playbackReady=new Promise(r=>releasePlayback=r);
const prefetched=createLocalSpeechStream(controller.signal,()=>{}, {context,synthesisReady,playbackReady,streamRequest:async()=>{requests++;return new Response([JSON.stringify({type:'chunk',index:0,wav}),JSON.stringify({type:'done',chunkCount:1})].join('\n')+'\n');}});
prefetched.push('本回答です。');await tick();assert.equal(requests,0,'avoid simultaneous Qwen synthesis');
releaseGeneration();await tick();await tick();assert.equal(requests,1,'answer synthesis starts during receipt playback');assert.equal(sources.length,0,'never overlap receipt and answer playback');
releasePlayback();await tick();await tick();assert.equal(sources.length,1);const prefetchedDone=prefetched.finish('本回答です。');sources[0].onended();await prefetchedDone;
console.log('PASS answer preparation overlaps receipt playback without overlapping audio or Qwen generation');

// A long notice must stop playing at the first answer delta without aborting Qwen.
sources=[];controller=new AbortController();let noticeController,noticeSignal,answerRequests=0,noticePrepared=0;
const prioritySpeech=createConversationSpeech(controller.signal,options=>createLocalSpeechStream(controller.signal,()=>{}, {...options,context,streamRequest:async(text,signal)=>{
 if(text==='資料の本文を確認しています。'){
  noticeSignal=signal;
  return new Response(new ReadableStream({start(c){noticeController=c;c.enqueue(new TextEncoder().encode(JSON.stringify({type:'chunk',index:0,wav})+'\n'));}}));
 }
 answerRequests++;assert.equal(noticePrepared,1,'Qwen notice generation must drain before answer synthesis');
 return new Response([JSON.stringify({type:'chunk',index:0,wav}),JSON.stringify({type:'done',chunkCount:1})].join('\n')+'\n');
},onPrepared:()=>{if(!answerRequests)noticePrepared++;options.onPrepared?.();}}));
prioritySpeech.progress('資料の本文を確認しています。');await tick();await tick();assert.equal(sources.length,1);
prioritySpeech.push('本回答です。');await tick();assert.equal(noticeSignal.aborted,false,'stopping a notice must not restart the Qwen worker');assert.equal(answerRequests,0,'no overlapping Qwen requests');
assert.equal(sources[0].stopped,true,'first answer delta immediately stops the scheduled notice');
noticeController.enqueue(new TextEncoder().encode(JSON.stringify({type:'chunk',index:1,wav})+'\n'+JSON.stringify({type:'done',chunkCount:2})+'\n'));noticeController.close();
await tick();await tick();assert.equal(sources.length,2,'late notice chunks remain silent; only answer audio is scheduled');assert.equal(answerRequests,1);
const priorityDone=prioritySpeech.finish('本回答です。');sources[1].onended();await priorityDone;
console.log('PASS first answer delta silences notices, drains synthesis and preserves serial Qwen requests');
