import {LocalVoice,LOCAL_RECEIPT_TEXT} from '../local-voice.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
const root=mkdtempSync(path.join(os.tmpdir(),'rei-voice-stream-'));
writeFileSync(path.join(root,'model.safetensors'),'fixture');
writeFileSync(path.join(root,'local-tts-worker.py'),`const readline=require('node:readline');console.log(JSON.stringify({type:'ready'}));readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);const out=value=>console.log(JSON.stringify({id:r.id,...value}));out({type:'chunk',index:r.text==='bad'?1:0,wav:'UklGRg==',sampleRate:24000,audioSeconds:0.5,firstGeneratedSeconds:0.01});setTimeout(()=>out({type:'done',chunkCount:1,audioSeconds:0.5,firstGeneratedSeconds:0.01,totalSeconds:0.1}),100);});`);
const voice=new LocalVoice(root,{python:process.execPath,model:root,timeoutMs:2000});
try{
 let chunks=[],complete=false;const promise=voice.synthesize('試験',{onChunk:chunk=>{assert.equal(complete,false);chunks.push(chunk);}}).then(result=>{complete=true;return result;});
 const result=await promise;assert.equal(chunks.length,1);assert.equal(chunks[0].index,0);assert.equal(result.firstGeneratedSeconds,0.01);assert.equal(result.wav,undefined);assert.equal(result.chunkCount,1);assert.equal(result.workerGeneration,1);assert.equal(result.workerStartReason,'initial');assert.equal(voice.status().busy,false);
 await voice.prepareReceipt();let cachedChunks=[];
 const cached=await voice.synthesize(LOCAL_RECEIPT_TEXT,{onChunk:chunk=>cachedChunks.push(chunk)});
 assert.equal(cached.cached,true);assert.equal(cached.preparationMs,0);assert.equal(cached.totalSeconds,0);assert.equal(cachedChunks.length,1);
 cachedChunks[0].wav='mutated';const replay=[];await voice.synthesize(LOCAL_RECEIPT_TEXT,{onChunk:c=>replay.push(c)});assert.equal(replay[0].wav,'UklGRg==');
 const cacheAbort=new AbortController();cacheAbort.abort();await assert.rejects(voice.synthesize(LOCAL_RECEIPT_TEXT,{signal:cacheAbort.signal,onChunk:()=>{throw Error('aborted cache must not emit');}}),/中断/);
 let freshChunks=[];const fresh=await voice.synthesize('別の本文',{onChunk:c=>freshChunks.push(c)});assert.equal(fresh.cached,undefined);assert.equal(freshChunks.length,1);assert.equal(fresh.workerGeneration,1);
 await assert.rejects(voice.synthesize('bad' ,{onChunk:()=>{throw Error('must not emit invalid sequence');}}));
 const abort=new AbortController();let received;const first=new Promise(r=>received=r);const pending=voice.synthesize('中断',{signal:abort.signal,onChunk:()=>received()});await first;abort.abort();await assert.rejects(pending,/停止/);assert.equal(voice.status().busy,false);assert.equal(voice.status().ready,false);
 const recovered=await voice.synthesize('再開',{onChunk:()=>{}});assert.equal(recovered.workerGeneration,3);assert.equal(recovered.workerStartReason,'client_abort');
 const reused=await voice.synthesize('継続',{onChunk:()=>{}});assert.equal(reused.workerGeneration,3);assert.equal(reused.workerStartReason,'client_abort');
 assert.deepEqual(Object.keys(reused).filter(key=>key.startsWith('worker')).sort(),['workerGeneration','workerStartReason']);
 console.log('local Qwen chunk delivery before completion, sequence validation and abort passed');
}finally{voice.close();rmSync(root,{recursive:true,force:true});}
