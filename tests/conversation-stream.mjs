import assert from 'node:assert/strict';
import {streamedAnswerPrefix,converse} from '../conversation.mjs';
import {readResponseStream} from '../chatgpt-plan.mjs';
import {readConversationStream} from '../public/conversation-stream.js';
import {createLocalSpeechStream} from '../public/local-voice.js';
import {VoiceConversation} from '../public/voice.js';
const encoder=new TextEncoder();
const answer=JSON.stringify({decision:{action:'answer',text:'こんにちは。\n"確認"😀'}});
let previous='';for(let i=1;i<=answer.length;i++){const text=streamedAnswerPrefix(answer.slice(0,i));assert.ok(text.startsWith(previous));previous=text;}assert.equal(previous,'こんにちは。\n"確認"😀');
assert.equal(streamedAnswerPrefix('{"decision":{"action":"search","query":"secret"'), '');
let complete=false,deltas=[];
const response=new Response(new ReadableStream({start(c){c.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"first"}\n\n'));setTimeout(()=>{complete=true;c.enqueue(encoder.encode('data: {"type":"response.completed"}\n\n'));c.close();},10);}}));
await readResponseStream(response,{onDelta:text=>{assert.equal(complete,false);deltas.push(text);}});assert.deepEqual(deltas,['first']);
const events=[];let sourceRead=false;
const result=await converse({question:'会社の予定は？',groups:[{id:'g',name:'共有'}],onDelta:text=>{assert.equal(sourceRead,true);events.push(text);},generate:async(messages,{onDelta})=>{
 if(!sourceRead){onDelta?.('{"decision":{"action":"answer","text":"未検証"}}');return {text:'{"action":"search","query":"予定"}'};}
 const raw='{"decision":{"action":"answer","text":"確認した予定です。"}}';for(let i=1;i<=raw.length;i++)onDelta?.(raw.slice(0,i));return {text:raw};
},call:async tool=>{if(tool==='get_fact_source'){sourceRead=true;return {structuredContent:{sources:[{traceable:true}]}};}return {structuredContent:{facts:[{uuid:'fact',group_id:'g',fact:'予定'}]}};},submit:()=>{throw Error('no work')}});
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
const voice=new VoiceConversation({Recognition:class{},ask:async(q,c,s,onDelta)=>{onDelta('こんにちは。');return new Promise(r=>resolveFinal=r);},onChange:s=>changes.push(s)});
voice.streamReply=(signal,onPlaying)=>({push(t){spokenParts.push(t);onPlaying();},async finish(){},cancel(){}});voice.active=true;voice.epoch=1;voice.listen=()=>{voice.phase='listening';};const responding=voice.respond('こんにちは',1);assert.deepEqual(spokenParts,['こんにちは。']);assert.equal(voice.history.length,0);resolveFinal('こんにちは。');await responding;assert.equal(voice.history.length,1);assert.equal(voice.phase,'listening');voice.stop();
console.log('incremental decoding, source gate, transport completion, ordered audio and continuous voice passed');
