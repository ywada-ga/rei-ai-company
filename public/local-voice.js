import {speechChunks} from './voice.js';
export async function playLocalVoice(text,signal,request,{AudioClass=globalThis.Audio,urls=globalThis.URL}={}) {
  const result=await request('/api/voice/local/speak',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text}),signal});
  return playVoiceAudio(result,signal,{AudioClass,urls});
}
async function playVoiceAudio(result,signal,{AudioClass=globalThis.Audio,urls=globalThis.URL}={}) {
  if(signal.aborted)throw new Error('音声を中断しました');
  const bytes=Uint8Array.from(atob(result.wav),c=>c.charCodeAt(0));
  const url=urls.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
  const audio=new AudioClass(url);
  try{await new Promise((resolve,reject)=>{
    const cleanup=()=>{signal.removeEventListener('abort',abort);audio.onended=null;audio.onerror=null;};
    const abort=()=>{audio.pause();cleanup();reject(new Error('音声を中断しました'));};
    audio.onended=()=>{cleanup();resolve();};audio.onerror=()=>{cleanup();reject(new Error('音声を再生できませんでした'));};
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(audio.play()).catch(error=>{cleanup();reject(error);});
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
