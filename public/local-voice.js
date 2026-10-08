import {speechChunks} from './voice.js';
export async function playLocalVoice(text,signal,request,{AudioClass=globalThis.Audio,urls=globalThis.URL}={}) {
  const result=await request('/api/voice/local/speak',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text}),signal});
  return playVoiceAudio(result,signal,{AudioClass,urls});
}
async function playVoiceAudio(result,signal,{AudioClass=globalThis.Audio,urls=globalThis.URL,onPlaying=()=>{}}={}) {
  if(signal.aborted)throw new Error('音声を中断しました');
  const bytes=Uint8Array.from(atob(result.wav),c=>c.charCodeAt(0));
  const url=urls.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
  const audio=new AudioClass(url);
  try{await new Promise((resolve,reject)=>{
    const cleanup=()=>{signal.removeEventListener('abort',abort);audio.onended=null;audio.onerror=null;};
    const abort=()=>{audio.pause();cleanup();reject(new Error('音声を中断しました'));};
    audio.onended=()=>{cleanup();resolve();};audio.onerror=()=>{cleanup();reject(new Error('音声を再生できませんでした'));};
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(audio.play()).then(()=>{if(!signal.aborted)onPlaying();}).catch(error=>{cleanup();reject(error);});
  });}finally{audio.pause();audio.removeAttribute?.('src');urls.revokeObjectURL(url);}
}

export async function playLocalReply(text,signal,request,options={}) {
  const chunks=speechChunks(text,120);
  const controller=new AbortController();
  const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
  const prepare=chunk=>request('/api/voice/local/speak',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:chunk}),signal:controller.signal});
  try {
    let pending=chunks.length?prepare(chunks[0]):null;
    for(let index=0;index<chunks.length;index++) {
      const result=await pending;if(controller.signal.aborted)throw new Error('音声を中断しました');
      pending=index+1<chunks.length?prepare(chunks[index+1]):null;
      pending?.catch(()=>{});
      await playVoiceAudio(result,controller.signal,options);
    }
  }finally{controller.abort();signal.removeEventListener('abort',abort);}
}

// Serialize synthesis, but let the next phrase prepare while the current one plays.
export function createLocalSpeechStream(signal,request,options={}){
  const controller=new AbortController();let text='',pending='',synthesis=Promise.resolve(),playback=Promise.resolve(),failure=null;
  const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const chunkPlayer=options.streamRequest?createChunkPlayer(controller.signal,options):null;options={...options,chunkPlayer};
  const enqueue=phrase=>{
    if(!phrase.trim()||controller.signal.aborted)return;
    const audio=synthesis.then(()=>options.streamRequest?playChunkedVoice(phrase,controller.signal,options):request('/api/voice/local/speak',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:phrase}),signal:controller.signal})).then(result=>{options.onPrepared?.({characters:Array.from(phrase).length,preparationMs:result.preparationMs,firstGeneratedSeconds:result.firstGeneratedSeconds,totalSeconds:result.totalSeconds});return result;});
    synthesis=audio.then(()=>{});synthesis.catch(()=>{});
    playback=playback.then(async()=>{const result=await audio;if(!options.streamRequest)await playVoiceAudio(result,controller.signal,options);});
    audio.catch(error=>{failure=error;controller.abort();});playback.catch(error=>{failure=error;controller.abort();});
  };
  const flush=final=>{let match;while((match=pending.match(/^([\s\S]*?[。！？\n])([\s\S]*)$/))){for(const chunk of speechChunks(match[1],120))enqueue(chunk);pending=match[2];}while(Array.from(pending).length>=120){const chars=Array.from(pending);enqueue(chars.slice(0,120).join(''));pending=chars.slice(120).join('');}if(final){for(const chunk of speechChunks(pending,120))enqueue(chunk);pending='';}};
  return {
    push(delta){if(failure)throw failure;if(controller.signal.aborted)throw new Error('音声を中断しました');text+=delta;pending+=delta;flush(false);},
    async finish(answer){if(!answer.startsWith(text))throw new Error('途中の返答と完了した返答が一致しません');this.push(answer.slice(text.length));flush(true);try{await playback;if(chunkPlayer)await chunkPlayer.finish();if(failure)throw failure;}finally{chunkPlayer?.cancel();signal.removeEventListener('abort',abort);}},
    cancel(){controller.abort();chunkPlayer?.cancel();signal.removeEventListener('abort',abort);}
  };
}

// Speak the receipt first; it never triggers the meaningful answer onset callback.
export function createConversationSpeech(signal,create,options={}){
  let receipt=null,answer=null,received=false,answerStarted=false,blocked=false,canceled=false,failure=null;
  const pending=[];let receiptDone=Promise.resolve();
  const main=()=>answer||(answer=create({onPlaying:options.onPlaying,onPrepared:options.onPrepared}));
  const cancel=()=>{canceled=true;pending.length=0;receipt?.cancel();answer?.cancel();signal.removeEventListener('abort',cancel);};
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  return {
    receipt(text){
      if(canceled||received||answerStarted)return;
      text='まず概要から確認します。';received=true;blocked=true;receipt=create({onPlaying:options.onReceiptPlaying});receipt.push(text);
      receiptDone=receipt.finish(text).catch(()=>{receipt.cancel();}).then(()=>{
        blocked=false;if(!canceled)for(const delta of pending.splice(0))main().push(delta);
      }).catch(error=>{failure=error;});
    },
    push(delta){if(canceled)throw new Error('音声を中断しました');if(failure)throw failure;answerStarted=true;if(blocked)pending.push(delta);else main().push(delta);},
    async finish(text){try{await receiptDone;if(canceled)throw new Error('音声を中断しました');if(failure)throw failure;await main().finish(text);}finally{signal.removeEventListener('abort',cancel);}},
    cancel
  };
}

let voiceContext;
export async function unlockLocalVoice(){
  const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!Context)throw new Error('この環境では音声再生を利用できません');
  if(!voiceContext||voiceContext.state==='closed')voiceContext=new Context();
  await voiceContext.resume();return voiceContext;
}

// Keep one audio timeline across sentence requests. Each WAV is independently decoded.
export function createChunkPlayer(signal,{context=voiceContext,onPlaying=()=>{}}={}){
  if(!context)throw new Error('音声応答を有効にしてください');
  let end=0,started=false,closed=false,timer=null;const sources=new Set(),waits=[];
  const abort=()=>{closed=true;clearTimeout(timer);for(const source of sources)source.stop();};
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  return {
    async push(wav){
      if(closed)throw new Error('音声を中断しました');
      const bytes=Uint8Array.from(atob(wav),c=>c.charCodeAt(0));
      const buffer=await context.decodeAudioData(bytes.buffer);
      if(closed)throw new Error('音声を中断しました');
      await context.resume();if(closed)throw new Error('音声を中断しました');
      const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);
      const at=Math.max(context.currentTime+0.04,end);end=at+buffer.duration;sources.add(source);
      waits.push(new Promise(resolve=>{source.onended=()=>{sources.delete(source);source.disconnect();resolve();};}));
      source.start(at);
      if(!started){started=true;timer=setTimeout(()=>{if(!closed&&context.state==='running')onPlaying();},Math.max(0,(at-context.currentTime)*1000));}
    },
    async finish(){try{await Promise.all(waits);if(closed)throw new Error('音声を中断しました');}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}},
    cancel(){abort();signal.removeEventListener('abort',abort);}
  };
}

async function playChunkedVoice(text,signal,options){
  const player=options.chunkPlayer;let index=0,done=null,pending='';
  const response=await options.streamRequest(text,signal);
  if(!response.ok||!response.body)throw new Error('Qwen音声の配信を開始できませんでした');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  const consume=async line=>{
    if(!line.trim())return;
    const item=JSON.parse(line);
    if(done)throw new Error('音声配信の順序が不正です');
    if(item.type==='chunk'){
      if(item.index!==index++||typeof item.wav!=='string'||item.wav.length>2000000)throw new Error('音声片が不正です');
      await player.push(item.wav);
    }else if(item.type==='done'){
      if(!index||item.chunkCount!==index)throw new Error('音声片が不足しています');done=item;
    }else throw new Error('音声の配信を完了できませんでした');
  };
  try{
    while(true){const part=await reader.read();if(part.done)break;pending+=decoder.decode(part.value,{stream:true});if(pending.length>2200000)throw new Error('音声片が大きすぎます');let newline;while((newline=pending.indexOf('\n'))>=0){await consume(pending.slice(0,newline));pending=pending.slice(newline+1);}}
    pending+=decoder.decode();await consume(pending);if(!done)throw new Error('音声配信が途中で終了しました');return done;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
