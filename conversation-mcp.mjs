import {readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {runOpenClawCli} from './openclaw-process.mjs';

// Reuse the pinned, bundled MCP transport/OAuth implementation, not its agent.
// No AI inference, agent job or credential copy happens here.
export class ConversationMcp {
  constructor(root){this.root=root;this.catalogFlights=new WeakMap();}
  async dispose(){await this.runtime?.dispose();this.runtime=null;this.signature=null;}
  async close(){await this.connecting?.catch(()=>{});await this.dispose();}
  async connect(integration){
    if(integration?.url!=='https://mcp.synapse-connect.ai/mcp'||!/^rei_[a-f0-9]{12}$/.test(integration.name))throw new Error('このPCのSynapse Connect連携が必要です');
    if(this.connecting)await this.connecting;
    if(this.runtime&&this.signature===integration.name)return this.runtime;
    const pending=this.open(integration);this.connecting=pending;
    try{return await pending;}finally{if(this.connecting===pending)this.connecting=null;}
  }
  async open(integration){
    await this.dispose();
    const entry=process.env.REI_OPENCLAW_ENTRY;
    if(!entry)throw new Error('同梱OpenClawのMCP接続先が設定されていません');
    const dist=path.join(path.dirname(entry),'dist');
    const modules=readdirSync(dist).filter(name=>/^agent-bundle-mcp-runtime-.*\.js$/.test(name));
    if(modules.length!==1)throw new Error('同梱MCP接続機能の版を確認してください');
    const {n:create}=await import(pathToFileURL(path.join(dist,modules[0])).href);
    if(typeof create!=='function')throw new Error('同梱MCP接続機能を確認してください');
    const output=runOpenClawCli(['config','get','mcp']);
    if(output.status!==0)throw new Error('Synapse Connectの接続設定を取得できません');
    const saved=JSON.parse(output.stdout),server=saved.servers?.[integration.name];
    if(server?.url!==integration.url)throw new Error('Synapse Connectの接続設定が一致しません');
    this.runtime=create({sessionId:'rei-conversation-direct',workspaceDir:this.root,cfg:{mcp:{servers:{[integration.name]:{...server,connectionTimeoutMs:30000,requestTimeoutMs:30000}}}},manifestRegistry:{plugins:[]}});
    this.signature=integration.name;return this.runtime;
  }
  async call(integration,tool,args,signal){
    if(!['survey_space','search_memory_facts','search_episodes','get_fact_source','get_episode','get_updates'].includes(tool))throw new Error('会話からは読み取り専用の検索だけを利用できます');
    if(!Array.isArray(args.group_ids)||!args.group_ids.length)throw new Error('検索範囲が必要です');
    if(tool==='get_updates'&&(args.advance!==false||!args.group_ids.includes(args.group_id)))throw new Error('追加履歴は選択範囲内で栞を変更せず読み取る必要があります');
    const started=performance.now();
    const runtime=await this.connect(integration);if(signal?.aborted)throw new Error('検索を中断しました');
    const ready=performance.now();
    let result;
    const wireArgs=tool==='get_updates'?Object.fromEntries(Object.entries(args).filter(([key])=>key!=='group_ids')):args;
    try{result=await runtime.callTool(integration.name,tool,wireArgs);}catch{await this.close();throw new Error('Synapse Connectの検索に接続できませんでした。接続状態を確認して再試行してください');}
    if(signal?.aborted)throw new Error('検索を中断しました');
    const finished=performance.now();
    return {...result,reiMcpTiming:{connectMs:Math.round(ready-started),requestMs:Math.round(finished-ready),totalMs:Math.round(finished-started)}};
  }
  async catalog(integration){
    const runtime=await this.connect(integration);
    // Share only an unfinished request on the exact authenticated runtime.
    // Never retain a completed catalog: later permission checks fetch again.
    let flights=this.catalogFlights.get(runtime);
    if(!flights){flights=new Map();this.catalogFlights.set(runtime,flights);}
    let pending=flights.get(integration.name);
    if(!pending){
      pending=Promise.resolve().then(()=>runtime.callTool(integration.name,'list_groups',{limit:1000}));
      flights.set(integration.name,pending);
    }
    try{return structuredClone(await pending);}
    finally{if(flights.get(integration.name)===pending)flights.delete(integration.name);}
  }
}
