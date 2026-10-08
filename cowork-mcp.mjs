// Local stdio MCP bridge. No network, API key, subscription token or shell tools.
import {DatabaseSync} from 'node:sqlite';
import {createInterface} from 'node:readline';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {coworkSeen,listCowork,claimCowork,reportCowork} from './cowork.mjs';
const dir=process.argv[process.argv.indexOf('--data-dir')+1];
if(!process.argv.includes('--data-dir')||!path.isAbsolute(dir)||!existsSync(path.join(dir,'rei.sqlite')))throw new Error('REIの保存先が見つかりません');
const db=new DatabaseSync(path.join(dir,'rei.sqlite'));db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
const idSchema={type:'string',pattern:'^[0-9a-f-]{36}$'};
const tools=[
 {name:'rei_list_jobs',description:'REIで人がCoworkへの共有と実行を承認した依頼だけを一覧にします。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'rei_claim_job',description:'承認済み依頼を一度だけ受け取ります。受け取り証は報告に必要です。',inputSchema:{type:'object',properties:{taskId:idSchema},required:['taskId'],additionalProperties:false}},
 {name:'rei_report_result',description:'実施内容・未実施内容・成果物をREIに報告します。人の確認待ちとなり、自動で完了にはなりません。',inputSchema:{type:'object',properties:{taskId:idSchema,receipt:{type:'string',pattern:'^cowork:[0-9a-f-]{36}$'},summary:{type:'string',minLength:1,maxLength:8000}},required:['taskId','receipt','summary'],additionalProperties:false}}
];
let initialized=false;const heartbeat=setInterval(()=>{if(initialized)try{coworkSeen(db);}catch{}},30000);heartbeat.unref();
const output=value=>process.stdout.write(JSON.stringify(value)+'\n');
function call(name,args){
 if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('入力形式を確認してください');
 const expected={rei_list_jobs:[],rei_claim_job:['taskId'],rei_report_result:['taskId','receipt','summary']}[name];
 if(!expected||Object.keys(args).some(k=>!expected.includes(k))||expected.some(k=>typeof args[k]!=='string'))throw new Error('入力項目を確認してください');
 if(args.taskId&&!/^[0-9a-f-]{36}$/.test(args.taskId))throw new Error('依頼IDを確認してください');
 if(name==='rei_report_result'&&!/^cowork:[0-9a-f-]{36}$/.test(args.receipt))throw new Error('受け取り証を確認してください');
 return name==='rei_list_jobs'?listCowork(db):name==='rei_claim_job'?claimCowork(db,args.taskId):reportCowork(db,args);
}
const rl=createInterface({input:process.stdin});
rl.on('line',line=>{
 let req;try{if(line.length>100000)throw Error();req=JSON.parse(line);}catch{output({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});return;}
 if(req.id===undefined)return;
 let result;
 if(req.method==='initialize'){const version=req.params?.protocolVersion;if(!['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(version)){output({jsonrpc:'2.0',id:req.id,error:{code:-32602,message:'Unsupported protocol version'}});return;}initialized=true;coworkSeen(db);result={protocolVersion:version,capabilities:{tools:{}},serverInfo:{name:'rei-cowork',version:'1.0.0'}};}
 else if(!initialized){output({jsonrpc:'2.0',id:req.id,error:{code:-32000,message:'Initialize first'}});return;}
 else if(req.method==='ping')result={};
 else if(req.method==='tools/list')result={tools};
 else if(req.method==='resources/list')result={resources:[]};
 else if(req.method==='prompts/list')result={prompts:[]};
 else if(req.method==='tools/call'){try{result={content:[{type:'text',text:JSON.stringify(call(req.params?.name,req.params?.arguments||{}))}]};}catch(error){result={isError:true,content:[{type:'text',text:error.message}]};}}
 else {output({jsonrpc:'2.0',id:req.id,error:{code:-32601,message:'Method not found'}});return;}
 output({jsonrpc:'2.0',id:req.id,result});
});
rl.on('close',()=>{clearInterval(heartbeat);db.close();});
