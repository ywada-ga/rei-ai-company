import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,copyFileSync,cpSync,readdirSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {readConversationStream} from '../public/conversation-stream.js';
const root=path.resolve(import.meta.dirname,'..'),tmp=mkdtempSync(path.join(os.tmpdir(),'rei-stream-api-'));
for(const name of readdirSync(root))if(name.endsWith('.mjs'))copyFileSync(path.join(root,name),path.join(tmp,name));
cpSync(path.join(root,'public'),path.join(tmp,'public'),{recursive:true});
// Run the fixture worker through Node on every OS; no executable shebang or Python required.
writeFileSync(path.join(tmp,'package.json'),JSON.stringify({version:'0.5.39',type:'commonjs'}));
writeFileSync(path.join(tmp,'public/package.json'),JSON.stringify({type:'module'}));
writeFileSync(path.join(tmp,'model.safetensors'),'fixture');
writeFileSync(path.join(tmp,'local-chat-worker.py'),`const readline=require('node:readline');console.log(JSON.stringify({type:'ready'}));readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({id:r.id,text:JSON.stringify({action:'answer',text:'こんにちは。試験の返答です。'})}));});`);
writeFileSync(path.join(tmp,'local-tts-worker.py'),`const readline=require('node:readline');console.log(JSON.stringify({type:'ready'}));readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({id:r.id,type:'chunk',index:0,wav:'UklGRg==',sampleRate:24000,audioSeconds:0.5}));setTimeout(()=>console.log(JSON.stringify({id:r.id,type:'done',chunkCount:1,audioSeconds:0.5,totalSeconds:0.05})),50);});`);
const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
// Spawn the real Hub with fixture-only data and a model worker that never calls external AI.
const child=spawn(process.execPath,[path.join(tmp,'hub.mjs')],{cwd:tmp,env:{...process.env,REI_PORT:String(port),REI_DATA_DIR:tmp,REI_LOCAL_CHAT_PYTHON:process.execPath,REI_LOCAL_CHAT_MODEL:tmp,REI_LOCAL_VOICE_PYTHON:process.execPath,REI_LOCAL_VOICE_MODEL:tmp},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);
const base=`http://127.0.0.1:${port}`;let cookie='';
try{
 for(let i=0;i<100&&!log.includes('REI Hub:');i++)await new Promise(r=>setTimeout(r,20));assert.ok(log.includes('REI Hub:'),log.replace(/\?setup=[^\s]+/g,'?setup=redacted'));
 const setup=log.match(/\?setup=([^\s]+)/)[1];
 const post=async(route,value,authenticated=true)=>fetch(base+'/api?route='+encodeURIComponent(route),{method:'POST',headers:{'content-type':'application/json',...(authenticated?{cookie}:{} )},body:JSON.stringify(value)});
 const registered=await post('setup/complete',{token:setup,username:'owner',password:'stream-fixture-password'},false);assert.equal(registered.status,201);const login=await post('auth/login',{username:'owner',password:'stream-fixture-password'},false);assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await post('conversation/stream',{question:'こんにちは'},false)).status,401);
 assert.equal((await fetch(base+'/api?route=conversation%2Fprefetch')).status,401);
 const prefetchStatus=await (await fetch(base+'/api?route=conversation%2Fprefetch',{headers:{cookie}})).json();
 assert.equal(prefetchStatus.state,'unconfigured');assert.equal(prefetchStatus.usable,false);assert.equal(prefetchStatus.records,undefined,'status must not expose cached company bodies');
 assert.equal((await fetch(base+'/conversation-stream.js')).status,200);assert.equal((await fetch(base+'/conversation-progress.js')).status,200);
 const response=await post('conversation/stream',{question:'REIについて教えて'});assert.match(response.headers.get('content-type'),/ndjson/);const result=await readConversationStream(response);assert.equal(result.answer,'こんにちは。試験の返答です。');
 const history=await (await fetch(base+'/api?route=conversation%2Fhistory',{headers:{cookie}})).json();assert.equal(history.turns.length,1);assert.equal(history.turns[0].answer,result.answer);
 assert.equal((await post('voice/local/stream',{text:'試験'},false)).status,401);
 assert.equal((await post('voice/local/stream',{text:''})).status,400);
 const audio=await post('voice/local/stream',{text:'試験'});assert.match(audio.headers.get('content-type'),/ndjson/);let events='';let firstAt=null,doneAt=null;for await(const bytes of audio.body){events+=new TextDecoder().decode(bytes);if(firstAt===null&&events.includes('"type":"chunk"'))firstAt=performance.now();if(events.includes('"type":"done"'))doneAt=performance.now();}assert.ok(firstAt!==null&&doneAt>firstAt,'audio chunk precedes completion');const audioEvents=events.trim().split('\n').map(JSON.parse);assert.deepEqual(audioEvents.map(e=>e.type),['chunk','done']);assert.equal(audioEvents[1].wav,undefined);assert.equal(audioEvents[1].chunkCount,1);
 const emptyScope=await (await fetch(base+'/api?route=conversation%2Fscope',{headers:{cookie}})).json();assert.equal(emptyScope.groups.length,0);
 assert.equal((await post('conversation/scope',{groups:[{id:'invented',name:'未確認'}]})).status,400);
 const fixtureDb=new DatabaseSync(path.join(tmp,'rei.sqlite'));
 const owner=fixtureDb.prepare("SELECT id FROM users WHERE role='owner'").get();
 fixtureDb.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(`conversation-catalog:${owner.id}`,JSON.stringify({at:Date.now(),groups:[{id:'private-fixture',name:'本人用の棚',personal:true}]}));
 assert.equal((await post('conversation/scope',{groups:[{id:'private-fixture',name:'本人用の棚'}]})).status,200);
 const privateScope=await (await fetch(base+'/api?route=conversation%2Fscope',{headers:{cookie}})).json();assert.equal(privateScope.groups[0].personal,true);
 fixtureDb.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify({scope:JSON.stringify(privateScope.groups),turns:[{question:'private fixture',answer:'PRIVATE_FIXTURE_SECRET',synapseRead:true}]}),`conversation:${owner.id}`);
 const draftResponse=await post('conversation/ask',{question:'実行して'});assert.equal(draftResponse.status,200);const draft=await draftResponse.json();
 const draftRow=fixtureDb.prepare('SELECT * FROM tasks WHERE id=?').get(draft.task.id);assert.equal(draftRow.knowledge_context,'[]');assert.ok(!JSON.stringify(draftRow).includes('PRIVATE_FIXTURE_SECRET'));
 const globalSettings=fixtureDb.prepare("SELECT value FROM settings WHERE key='company_intelligence'").get();assert.ok(!globalSettings||JSON.parse(globalSettings.value).groups.length===0,'personal scope must not change shared scans');
 assert.ok(fixtureDb.prepare('SELECT value FROM settings WHERE key=?').get(`conversation-scope:${owner.id}`));fixtureDb.prepare("UPDATE users SET role='admin' WHERE id=?").run(owner.id);const downgradedScope=await (await fetch(base+'/api?route=conversation%2Fscope',{headers:{cookie}})).json();assert.equal(downgradedScope.groups.length,0,'an admin must not inherit owner personal scope');assert.equal((await post('conversation/scope',{groups:[{id:'private-fixture',name:'本人用の棚'}]})).status,400);fixtureDb.prepare("UPDATE users SET role='owner' WHERE id=?").run(owner.id);fixtureDb.close();
 console.log('real Hub streaming route, auth, completion, fallback and stored history passed (fixture model)');
}finally{if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}rmSync(tmp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
