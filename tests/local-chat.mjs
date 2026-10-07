import {LocalChat} from '../local-chat.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root=mkdtempSync(path.join(os.tmpdir(),'rei-chat-worker-'));
writeFileSync(path.join(root,'model.safetensors'),'fixture');
writeFileSync(path.join(root,'local-chat-worker.py'),`const readline=require('node:readline');
console.log(JSON.stringify({type:'ready'}));
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);setTimeout(()=>console.log(JSON.stringify({id:r.id,text:'{"action":"answer","text":"こんにちは"}'})),r.messages[0].content==='slow'?1000:5);});`);
const chat=new LocalChat(root,{python:process.execPath,model:root,timeoutMs:2000});
try{
  assert.equal(chat.status().configured,true);await chat.start();assert.equal(chat.status().ready,true);
  assert.match((await chat.generate([{role:'user',content:'hello'}])).text,/こんにちは/);
  const abort=new AbortController();const pending=chat.generate([{role:'user',content:'slow'}],{signal:abort.signal});await new Promise(r=>setTimeout(r,20));
  await assert.rejects(chat.generate([{role:'user',content:'hello'}]),/返答中/);abort.abort();await assert.rejects(pending,/停止/);
  assert.equal(chat.status().ready,false);assert.equal(chat.status().busy,false);
  await chat.start();assert.match((await chat.generate([{role:'user',content:'hello'}])).text,/こんにちは/);
  console.log('local chat persistent worker, busy guard, abort and restart passed');
}finally{chat.close();rmSync(root,{recursive:true,force:true});}
