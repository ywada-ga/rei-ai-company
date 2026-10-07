import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {openStorage,one} from '../storage.mjs';
import {configureLiveVoice,liveVoiceStatus,LiveVoiceSessions} from '../live-voice.mjs';
import {LiveVoiceConversation} from '../public/live-voice.js';
const dir=mkdtempSync(path.join(os.tmpdir(),'rei-live-voice-'));const savedData=process.env.REI_DATA_DIR;process.env.REI_DATA_DIR=dir;const db=openStorage(dir);
try{
 assert.equal(liveVoiceStatus(db,dir).configured,false);
 const token='sk-test-fixture-123456789012345';
 assert.throws(()=>configureLiveVoice(db,dir,{apiKey:token}),/確認/);
 assert.equal(configureLiveVoice(db,dir,{apiKey:token,consent:true}).configured,true);
 assert.ok(!one(db,"select value from settings where key='voice_api_key'").value.includes(token));
 const calls=[];const sessions=new LiveVoiceSessions({fetcher:async(url,options)=>{calls.push({url,options});return url.endsWith('/hangup')?new Response('',{status:200}):Response.json({session:{id:'live_fixture'},transport:{sdp:'v=0\r\nanswer'}});}});
 await assert.rejects(()=>sessions.create(db,dir,'owner','invalid'),/形式/);
 const session=await sessions.create(db,dir,'owner','v=0\r\noffer');assert.equal(session.sdp,'v=0\r\nanswer');assert.equal(JSON.stringify(session).includes(token),false);
 const config=JSON.parse(calls[0].options.body);assert.equal(config.session.delegation.type,'client');assert.equal(config.session.store,false);assert.match(config.session.instructions,/SynapseConnect/);
 await assert.rejects(()=>sessions.create(db,dir,'owner','v=0\r\noffer'),/既に/);
 await assert.rejects(()=>sessions.close('another',session.id),/別の利用者/);
 await sessions.close('owner',session.id);assert.equal(sessions.sessions.size,0);assert.match(calls.at(-1).url,/live_fixture\/hangup$/);
 let durationHangups=0;const boundedSessions=new LiveVoiceSessions({maxDurationMs:10,fetcher:async url=>{if(url.endsWith('/hangup')){durationHangups++;return new Response('',{status:200});}return Response.json({session:{id:'opaque:fixture'},transport:{sdp:'v=0\r\nanswer'}});}});
 await boundedSessions.create(db,dir,'owner','v=0\r\noffer');await new Promise(r=>setTimeout(r,25));assert.equal(durationHangups,1);assert.equal(boundedSessions.sessions.size,0);
 const encrypted=readFileSync(path.join(dir,'voice.key'));writeFileSync(path.join(dir,'voice.key'),'bad');assert.equal(liveVoiceStatus(db,dir).needsAttention,true);await assert.rejects(()=>sessions.create(db,dir,'owner','v=0\r\n'),/暗号鍵/);writeFileSync(path.join(dir,'voice.key'),encrypted);
 // WebRTC and event handling are mocked; this verifies lifecycle, never actual audio quality.
 class Events {constructor(){this.handlers={};this.readyState='open';this.sent=[];}addEventListener(n,fn){this.handlers[n]=fn;}send(s){this.sent.push(JSON.parse(s));}close(){this.closed=true;}fire(event){this.handlers.message({data:JSON.stringify(event)});}}
 let peer,stopped=0,ended=[],resolveLookup,receivedContext;
 class Peer {constructor(){peer=this;this.handlers={};this.iceGatheringState='complete';this.connectionState='connected';}addEventListener(n,fn){this.handlers[n]=fn;}addTrack(){}createDataChannel(){return this.events=new Events();}async createOffer(){return {type:'offer',sdp:'v=0\r\noffer'};}async setLocalDescription(d){this.localDescription=d;}async setRemoteDescription(d){this.remoteDescription=d;}close(){this.closed=true;}}
 const stream={getTracks:()=>[{stop(){stopped++;}}],getAudioTracks:()=>[]};const audio={play:async()=>{},pause(){this.paused=true;}};
 const voice=new LiveVoiceConversation({Peer,media:{getUserMedia:async()=>stream},createAudio:()=>audio,createSession:async()=>({id:'fixture',sdp:'v=0\r\nanswer'}),endSession:async id=>{ended.push(id);},ask:async(q,context)=>{receivedContext={q,context};return new Promise(resolve=>resolveLookup=resolve);},onChange:()=>{}});
 await voice.start();peer.events.fire({type:'session.started'});assert.equal(voice.phase,'listening');
 peer.events.fire({type:'session.input_transcript.delta',delta:'会社の',start_ms:100,end_ms:200});
 peer.events.fire({type:'session.input_transcript.delta',delta:'予定は？',start_ms:200,end_ms:400});
 peer.events.fire({type:'session.output_transcript.delta',delta:'確認するね。',start_ms:500,end_ms:800});
 assert.equal(voice.history[0].question,'会社の予定は？');
 peer.events.fire({type:'session.delegation.created',offset_ms:900,delegation:{id:'delegate_1',target:'client'}});assert.equal(receivedContext.q,'会社の予定は？');
 voice.interrupt();assert.equal(voice.phase,'listening');assert.equal(audio.muted,true);
 resolveLookup({status:'answered',answer:'予定は金曜日です。',uncertainties:[]});await new Promise(r=>setTimeout(r,0));assert.ok(peer.events.sent.some(e=>e.type==='session.commentary.append'&&e.delegation_id==='delegate_1'));
 peer.events.fire({type:'session.input_transcript.delta',delta:'別の',start_ms:2500,end_ms:2700});peer.events.fire({type:'session.input_transcript.delta',delta:'予定は？',start_ms:2700,end_ms:2900});assert.equal(voice.transcript,'別の予定は？');assert.equal(audio.muted,false);
 peer.events.fire({type:'session.delegation.created',offset_ms:3000,delegation:{id:'delegate_2',target:'client'}});voice.stop();const sent=peer.events.sent.length;resolveLookup({status:'answered',answer:'遅い回答',uncertainties:[]});await new Promise(r=>setTimeout(r,0));assert.equal(peer.events.sent.length,sent);assert.ok(stopped);assert.deepEqual(ended,['fixture']);assert.ok(peer.closed);
 console.log('PASS encrypted voice configuration, session ownership, provider hangup, live transcript delegation and late-result suppression (mock audio)');
}finally{db.close();rmSync(dir,{recursive:true,force:true});if(savedData===undefined)delete process.env.REI_DATA_DIR;else process.env.REI_DATA_DIR=savedData;}
