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
  const enqueue=phrase=>{
    if(!phrase.trim()||controller.signal.aborted)return;
    const audio=synthesis.then(()=>request('/api/voice/local/speak',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:phrase}),signal:controller.signal}));
    synthesis=audio.then(()=>{});synthesis.catch(()=>{});
    playback=playback.then(async()=>{const result=await audio;await playVoiceAudio(result,controller.signal,options);});
    audio.catch(error=>{failure=error;controller.abort();});playback.catch(error=>{failure=error;controller.abort();});
  };
  const flush=final=>{let match;while((match=pending.match(/^([\s\S]*?[。！？\n])([\s\S]*)$/))){for(const chunk of speechChunks(match[1],120))enqueue(chunk);pending=match[2];}while(Array.from(pending).length>=120){const chars=Array.from(pending);enqueue(chars.slice(0,120).join(''));pending=chars.slice(120).join('');}if(final){for(const chunk of speechChunks(pending,120))enqueue(chunk);pending='';}};
  return {
    push(delta){if(failure)throw failure;if(controller.signal.aborted)throw new Error('音声を中断しました');text+=delta;pending+=delta;flush(false);},
    async finish(answer){if(!answer.startsWith(text))throw new Error('途中の返答と完了した返答が一致しません');this.push(answer.slice(text.length));flush(true);try{await playback;if(failure)throw failure;}finally{signal.removeEventListener('abort',abort);}},
    cancel(){controller.abort();signal.removeEventListener('abort',abort);}
  };
}
