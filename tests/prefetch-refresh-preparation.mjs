import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let enabledConversationPreparation=null;'),source.indexOf('async function refresh() {'));
let at=100000,resolveStatus,rejectStatus,checks=0,prepared=0,rendered=[];
const state={voiceOn:true,authEpoch:1};
const periodicView={textContent:''};
const context=vm.createContext({state,conversationPreparation:periodicView,conversationPreparationGeneration:0,Date:{now:()=>at},request:async()=>{checks++;return await new Promise((resolve,reject)=>{resolveStatus=resolve;rejectStatus=reject;});},renderConversationPreparationStatus:status=>rendered.push(status),trackConversationPreparation:async()=>{prepared++;}});
vm.runInContext(code,context);
const start=()=>vm.runInContext('prepareEnabledConversation()',context);
const settle=()=>new Promise(setImmediate);
start();start();assert.equal(checks,1);
resolveStatus({active:false,state:'empty'});await settle();assert.equal(prepared,1);
start();assert.equal(checks,1);
at+=30000;start();resolveStatus({active:true,state:'syncing'});await settle();assert.equal(prepared,1);
at+=30000;start();state.voiceOn=false;resolveStatus({active:false,state:'expired'});await settle();assert.equal(prepared,1);
state.voiceOn=true;at+=30000;start();state.authEpoch++;resolveStatus({active:false,state:'ready'});await settle();assert.equal(prepared,1);
at+=30000;start();resolveStatus({active:false,state:'ready'});await settle();assert.equal(prepared,2);
at+=30000;start();resolveStatus({state:'unconfigured'});await settle();assert.equal(prepared,2);
at+=30000;start();resolveStatus({active:true,state:'ready',usable:true,checkedAt:at});await settle();assert.equal(rendered.at(-1).checkedAt,at);assert.equal(prepared,2);
const before=rendered.length;
at+=30000;start();vm.runInContext('conversationPreparationGeneration++',context);resolveStatus({active:true,state:'ready',usable:true,checkedAt:at});await settle();assert.equal(rendered.length,before,'Changed scope/preparation generation rejects stale state');
at+=30000;start();rejectStatus(Error('offline'));await settle();assert.match(periodicView.textContent,/確認できません/);
periodicView.textContent='';at+=30000;start();state.voiceOn=false;rejectStatus(Error('offline'));await settle();assert.equal(periodicView.textContent,'');
const view={textContent:'',dataset:{}};
const renderContext=vm.createContext({conversationPreparation:view,formatTime:()=> 'CURRENT-TIME'});
vm.runInContext(source.slice(source.indexOf('function renderConversationPreparationStatus('),source.indexOf('async function trackConversationPreparation(')),renderContext);
for(const status of [{usable:true,state:'ready',recordCount:64,checkedAt:at,bodyCoverage:'limited',syncDiagnostics:{totalMs:30}},{usable:false,state:'syncing'},{usable:false,state:'expired'},{usable:false,state:'failed'}]){
 renderContext.status=status;vm.runInContext('renderConversationPreparationStatus(status)',renderContext);
 if(status.usable){assert.match(view.textContent,/64.*CURRENT-TIME.*一部/);assert.equal(JSON.parse(view.dataset.syncDiagnostics).totalMs,30);}
 else if(status.state==='syncing')assert.match(view.textContent,/準備中でも質問でき/);
 else {assert.match(view.textContent,/利用できません/);assert.ok(!view.textContent.includes('CURRENT-TIME'));}
 assert.match(view.textContent,/最新情報/);
}
console.log('PASS restart recovery with preserved or absent snapshot, deduplication, throttle, active skip and OFF/auth isolation');
console.log('PASS ongoing ready/expiry/failure display refresh without new preparation; scope generation rejects stale response');
