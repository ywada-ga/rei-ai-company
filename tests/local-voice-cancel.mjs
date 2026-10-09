import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';
import {LocalVoice} from '../local-voice.mjs';
import {CONVERSATION_PROGRESS} from '../public/conversation-progress.js';
const root=mkdtempSync(path.join(os.tmpdir(),'rei-voice-cancel-'));
writeFileSync(path.join(root,'model.safetensors'),'fixture');
const fixture=supported=>`const readline=require('node:readline');let active=null;console.log(JSON.stringify({type:'ready',cancelSupported:${supported}}));readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);const out=value=>console.log(JSON.stringify({id:r.id,...value}));if(r.type==='cancel'){if(!active||active.id!==r.id)throw Error('wrong cancellation target');clearTimeout(active.timer);if(active.text==='noack')return;out({type:'chunk',index:1,wav:'UklGRg==',sampleRate:24000,audioSeconds:0.5});out({id:'unrelated',type:'cancelled'});setTimeout(()=>{active=null;out({type:'cancelled'});},30);return;}if(active)throw Error('overlapping generation');out({type:'chunk',index:0,wav:'UklGRg==',sampleRate:24000,audioSeconds:0.5,firstGeneratedSeconds:0.01});active={id:r.id,text:r.text,timer:setTimeout(()=>{active=null;out({type:'done',chunkCount:1,audioSeconds:0.5,firstGeneratedSeconds:0.01,totalSeconds:0.1});},100)};});`;
writeFileSync(path.join(root,'local-tts-worker.py'),fixture(true));
let voice=new LocalVoice(root,{python:process.execPath,model:root,timeoutMs:2000});
try{
 const notice=Object.values(CONVERSATION_PROGRESS)[0];
 const cancel=new AbortController();let first,emitted=0;
 const received=new Promise(r=>first=r);
 const pending=voice.synthesize(notice,{cancelSignal:cancel.signal,onChunk:()=>{emitted++;first();}});
 const rejected=assert.rejects(pending,/中断/);await received;cancel.abort();
 assert.equal(voice.status().busy,true,'hold serialization until worker acknowledgement');
 await assert.rejects(voice.synthesize('too early',{onChunk:()=>{}}),error=>error.status===409);
 await rejected;assert.equal(emitted,1,'discard late chunks while cancellation is pending');
 assert.equal(voice.status().ready,true);assert.equal(voice.status().busy,false);
 assert.equal(voice.noticeCache.has(notice),false,'partial notice must not enter cache');
 const resumed=await voice.synthesize('answer',{onChunk:()=>{}});
 assert.equal(resumed.workerGeneration,1,'reuse worker after matching cancellation acknowledgement');
 assert.equal(resumed.workerStartReason,'initial');
 const cached=await voice.synthesize(notice,{onChunk:()=>{}});assert.equal(cached.cached,undefined);
 assert.equal((await voice.synthesize(notice,{onChunk:()=>{}})).cached,true);
 const preCancelled=new AbortController();preCancelled.abort();
 await assert.rejects(voice.synthesize('skip',{cancelSignal:preCancelled.signal,onChunk:()=>{throw Error('must not emit');}}),/中断/);
 voice.timeoutMs=300;
 const noAck=new AbortController();
 await assert.rejects(voice.synthesize('noack',{cancelSignal:noAck.signal,onChunk:()=>noAck.abort()}),/停止/);
 assert.equal(voice.status().ready,false,'timeout must stop a worker that does not acknowledge');
 const afterTimeout=await voice.synthesize('timeout recovery',{onChunk:()=>{}});
 assert.equal(afterTimeout.workerGeneration,2);assert.equal(afterTimeout.workerStartReason,'generation_timeout');
 voice.close();
 // Older workers have no cancellation capability: drain safely, suppress output,
 // and keep the same worker rather than send a protocol they do not understand.
 writeFileSync(path.join(root,'local-tts-worker.py'),fixture(false));
 voice=new LocalVoice(root,{python:process.execPath,model:root,timeoutMs:2000});
 const oldCancel=new AbortController();let oldEmitted=0;
 await assert.rejects(voice.synthesize('old',{cancelSignal:oldCancel.signal,onChunk:()=>{oldEmitted++;oldCancel.abort();}}),/中断/);
 assert.equal(oldEmitted,1);assert.equal(voice.status().ready,true);
 assert.equal((await voice.synthesize('old followup',{onChunk:()=>{}})).workerGeneration,1);
 console.log('PASS acknowledged Qwen generation cancellation, serialization, late suppression, cache integrity and older-worker fallback');
}finally{voice.close();rmSync(root,{recursive:true,force:true});}
