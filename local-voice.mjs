import {CONVERSATION_PROGRESS} from './public/conversation-progress.js';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const LOCAL_RECEIPT_TEXT='はい。';

export class LocalVoice {
  constructor(root,{python=process.env.REI_LOCAL_VOICE_PYTHON||path.join(root,'../local-voice/python/bin/python3'),model=process.env.REI_LOCAL_VOICE_MODEL||path.join(root,'../local-voice/qwen-model'),timeoutMs=120000}={}) {
    Object.assign(this,{root,python,model,timeoutMs});this.noticeCache=new Map();this.workerGeneration=0;this.workerStartReason='initial';this.lastStopReason='initial';
  }
  status(){return {configured:!!(this.python&&this.model&&existsSync(this.python)&&existsSync(path.join(this.model,'model.safetensors'))),ready:!!this.ready,busy:!!this.busy};}
  close(reason='manual_stop'){const child=this.child;if(child)this.lastStopReason=reason;this.child=null;this.ready=false;child?.kill();this.reject?.(new Error('ローカル音声を停止しました'));this.reject=null;}
  async start(){
    if(this.ready)return;
    if(this.starting)return this.starting;
    if(!this.status().configured)throw Object.assign(new Error('ローカル音声の準備ができていません'),{status:503});
    this.starting=new Promise((resolve,reject)=>{
      this.workerGeneration++;this.workerStartReason=this.lastStopReason;
      const child=this.child=spawn(this.python,[path.join(this.root,'local-tts-worker.py'),this.model],{stdio:['pipe','pipe','ignore'],env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',PYTHONDONTWRITEBYTECODE:'1'}});
      let buffer='';const timer=setTimeout(()=>{this.close('startup_timeout');reject(new Error('ローカル音声の起動に時間がかかっています'));},this.timeoutMs);
      const failed=()=>{clearTimeout(timer);if(this.child===child){this.close('worker_failure');reject(new Error('ローカル音声を起動できませんでした'));}};
      child.on('error',failed);child.on('exit',failed);
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
        if(this.child!==child)return;
        buffer+=chunk;if(buffer.length>10000000){failed();return;}
        let index;while((index=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
          try{const message=JSON.parse(line);
            if(message.type==='ready'){clearTimeout(timer);this.ready=true;resolve();}
            else if(message.id===this.pending?.id)this.pending.resolve(message);
          }catch{failed();return;}
        }
      });
    }).finally(()=>{this.starting=null;});
    return this.starting;
  }
  async prepareReceipt(){
    if(this.receiptCache)return;
    if(this.receiptPreparing)return this.receiptPreparing;
    if(this.busy)return;
    if(!this.receiptPreparing)this.receiptPreparing=this.synthesize(LOCAL_RECEIPT_TEXT,{onChunk:()=>{}}).finally(()=>{this.receiptPreparing=null;});
    return this.receiptPreparing;
  }
  async synthesize(text,{signal,onChunk}={}){
    if(typeof text!=='string'||!text.trim()||Array.from(text).length>500)throw Object.assign(new Error('音声の文章は500文字以内にしてください'),{status:400});
    if(signal?.aborted)throw new Error('音声を中断しました');
    if(text===LOCAL_RECEIPT_TEXT&&onChunk&&this.receiptCache){
      for(const chunk of this.receiptCache.chunks){if(signal?.aborted)throw new Error('音声を中断しました');onChunk({...chunk});}
      return {...this.receiptCache.result,preparationMs:0,firstGeneratedSeconds:0,totalSeconds:0,cached:true};
    }
    if(onChunk&&Object.values(CONVERSATION_PROGRESS).includes(text)&&this.receiptPreparing)await this.receiptPreparing;
    const cachedNotice=onChunk?this.noticeCache.get(text):null;
    if(cachedNotice){for(const chunk of cachedNotice.chunks){if(signal?.aborted)throw new Error('音声を中断しました');onChunk({...chunk});}return {...cachedNotice.result,preparationMs:0,firstGeneratedSeconds:0,totalSeconds:0,cached:true};}
    if(this.busy)throw Object.assign(new Error('ローカル音声は別の返答を作成中です'),{status:409});
    this.busy=true;
    try{
      const prepareStarted=performance.now();await this.start();const preparationMs=Math.round(performance.now()-prepareStarted);if(signal?.aborted)throw new Error('音声を中断しました');
      return await new Promise((resolve,reject)=>{
        const id=crypto.randomUUID();let timer,chunkCount=0;const receiptChunks=[],noticeChunks=[];
        const abort=()=>this.close('client_abort');
        const finish=(error,result)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending=null;this.reject=null;error?reject(error):resolve(result);};
        this.reject=error=>finish(error);
        this.pending={id,resolve:message=>{
          if(onChunk&&message.type==='chunk'){
            if(message.index!==chunkCount||typeof message.wav!=='string'||message.wav.length>2000000||!Number.isFinite(message.audioSeconds)||message.audioSeconds<=0||message.audioSeconds>30||!Number.isInteger(message.sampleRate)||message.sampleRate<8000||message.sampleRate>192000)return this.close('invalid_chunk');
            chunkCount++;const chunk={index:message.index,wav:message.wav,sampleRate:message.sampleRate,audioSeconds:message.audioSeconds,firstGeneratedSeconds:message.firstGeneratedSeconds};if(text===LOCAL_RECEIPT_TEXT)receiptChunks.push({...chunk});if(Object.values(CONVERSATION_PROGRESS).includes(text))noticeChunks.push({...chunk});onChunk(chunk);return;
          }
          if(onChunk?(message.type!=='done'||!chunkCount||message.chunkCount!==chunkCount):(message.type!=='audio'||typeof message.wav!=='string'))return finish(new Error('ローカル音声を作成できませんでした'));
          const result={...(onChunk?{chunkCount}:{}),wav:message.wav,audioSeconds:message.audioSeconds,totalSeconds:message.totalSeconds,firstGeneratedSeconds:message.firstGeneratedSeconds,preparationMs,workerGeneration:this.workerGeneration,workerStartReason:this.workerStartReason};
          if(text===LOCAL_RECEIPT_TEXT&&onChunk)this.receiptCache={chunks:receiptChunks,result};
          if(onChunk&&Object.values(CONVERSATION_PROGRESS).includes(text))this.noticeCache.set(text,{chunks:noticeChunks,result});
          finish(null,result);
        }};
        signal?.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>this.close('generation_timeout'),this.timeoutMs);
        this.child.stdin.write(JSON.stringify({id,text,stream:!!onChunk})+'\n',error=>{if(error)this.close('write_failure');});
      });
    }finally{this.busy=false;}
  }
}
