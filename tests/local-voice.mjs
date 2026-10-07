import assert from 'node:assert/strict';
import {playLocalVoice} from '../public/local-voice.js';
import {VoiceConversation} from '../public/voice.js';
let lastAudio,created=0,revoked=0;
class AudioMock {
  constructor(){lastAudio=this;}
  play(){return Promise.resolve();}
  pause(){this.paused=true;}
  removeAttribute(){}
}
const urls={createObjectURL(){created++;return 'blob:test';},revokeObjectURL(){revoked++;}};
const request=async()=>({wav:Buffer.from('RIFF').toString('base64')});
let controller=new AbortController();
const playing=playLocalVoice('返答',controller.signal,request,{AudioClass:AudioMock,urls});
await new Promise(resolve=>setTimeout(resolve,0));controller.abort();
await assert.rejects(playing,/中断/);assert.ok(lastAudio.paused);assert.equal(created,revoked);
controller=new AbortController();
const complete=playLocalVoice('返答',controller.signal,request,{AudioClass:AudioMock,urls});
await new Promise(resolve=>setTimeout(resolve,0));lastAudio.onended();await complete;assert.equal(created,revoked);
let late,listenCount=0;
const conversation=new VoiceConversation({synthesis:{cancel(){}},ask:async()=>''});
conversation.localSpeak=()=>new Promise(resolve=>{late=resolve;});
conversation.listen=()=>{listenCount++;};conversation.active=true;
conversation.say('返答');conversation.interrupt();assert.equal(listenCount,1);
late();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(listenCount,1,'late playback must not restart interrupted recognition');
conversation.say('次の返答');conversation.stop();late();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(listenCount,1);
console.log('PASS local playback abort, cleanup, completion and late-result suppression');
