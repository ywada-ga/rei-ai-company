import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class LocalChat {
  constructor(root,{python=process.env.REI_LOCAL_CHAT_PYTHON||path.join(root,'../local-voice/python/bin/python3'),model=process.env.REI_LOCAL_CHAT_MODEL||path.join(root,'../local-voice/conversation-model'),timeoutMs=90000}={}){Object.assign(this,{root,python,model,timeoutMs});}
  status(){return {configured:existsSync(this.python)&&existsSync(path.join(this.model,'model.safetensors')),ready:!!this.ready,busy:!!this.busy,model:'Qwen3-4B-Instruct-2507'};}
  close(){this.ready=false;this.child?.kill();this.child=null;this.fail?.(new Error('会話AIを停止しました'));this.fail=null;}
  async start(){
    if(this.ready)return;
    if(this.starting)return this.starting;
    if(!this.status().configured)throw Object.assign(new Error('会話AIの準備ができていません'),{status:503});
    this.starting=new Promise((resolve,reject)=>{
      const child=this.child=spawn(this.python,[path.join(this.root,'local-chat-worker.py'),this.model],{stdio:['pipe','pipe','ignore'],env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',PYTHONDONTWRITEBYTECODE:'1'}});
      let buffer='';const timer=setTimeout(()=>{this.close();reject(new Error('会話AIの準備に時間がかかっています'));},this.timeoutMs);
      const failed=()=>{clearTimeout(timer);if(this.child===child){this.close();reject(new Error('会話AIを起動できませんでした'));}};
      child.on('error',failed);child.on('exit',failed);
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
        if(this.child!==child)return;buffer+=chunk;if(buffer.length>1000000){failed();return;}
        let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
          try{const data=JSON.parse(line);if(data.type==='ready'){clearTimeout(timer);this.ready=true;resolve();}else if(data.id===this.pending?.id)this.pending.resolve(data);}catch{failed();return;}
        }
      });
    }).finally(()=>{this.starting=null;});return this.starting;
  }
  async generate(messages,{signal}={}){
    if(this.busy)throw Object.assign(new Error('会話AIが返答中です。少し待ってください'),{status:409});this.busy=true;
    try{await this.start();if(signal?.aborted)throw new Error('会話を中断しました');
      return await new Promise((resolve,reject)=>{
        const id=crypto.randomUUID(),abort=()=>this.close();let timer;
        const finish=(error,data)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending=null;this.fail=null;error?reject(error):resolve(data);};
        this.fail=error=>finish(error);this.pending={id,resolve:data=>data.error?finish(new Error('会話の返答を作れませんでした')):finish(null,data)};
        signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>this.close(),this.timeoutMs);
        this.child.stdin.write(JSON.stringify({id,messages})+'\n',error=>{if(error)this.close();});
      });
    }finally{this.busy=false;}
  }
}
