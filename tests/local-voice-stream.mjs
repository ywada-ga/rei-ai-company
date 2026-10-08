import {LocalVoice} from '../local-voice.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
const root=mkdtempSync(path.join(os.tmpdir(),'rei-voice-stream-'));
writeFileSync(path.join(root,'model.safetensors'),'fixture');
writeFileSync(path.join(root,'local-tts-worker.py'),`const readline=require('node:readline');console.log(JSON.stringify({type:'ready'}));readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);const out=value=>console.log(JSON.stringify({id:r.id,...value}));out({type:'chunk',index:r.text==='bad'?1:0,wav:'UklGRg==',sampleRate:24000,audioSeconds:0.5,firstGeneratedSeconds:0.01});setTimeout(()=>out({type:'done',chunkCount:1,audioSeconds:0.5,firstGeneratedSeconds:0.01,totalSeconds:0.1}),100);});`);
const voice=new LocalVoice(root,{python:process.execPath,model:root,timeoutMs:2000});
try{
 let chunks=[],complete=false;const promise=voice.synthesize('試験',{onChunk:chunk=>{assert.equal(complete,false);chunks.push(chunk);}}).then(result=>{complete=true;return result;});
 const result=await promise;assert.equal(chunks.length,1);assert.equal(chunks[0].index,0);assert.equal(result.firstGeneratedSeconds,0.01);assert.equal(result.wav,undefined);assert.equal(result.chunkCount,1);assert.equal(voice.status().busy,false);
 await assert.rejects(voice.synthesize('bad',{onChunk:()=>{throw Error('must not emit invalid sequence');}}));
 const abort=new AbortController();let received;const first=new Promise(r=>received=r);const pending=voice.synthesize('中断',{signal:abort.signal,onChunk:()=>received()});await first;abort.abort();await assert.rejects(pending,/停止/);assert.equal(voice.status().busy,false);assert.equal(voice.status().ready,false);
 console.log('local Qwen chunk delivery before completion, sequence validation and abort passed');
}finally{voice.close();rmSync(root,{recursive:true,force:true});}
