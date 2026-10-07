import {spokenText} from './voice.js';
export class LiveVoiceConversation {
 constructor({createSession,endSession,ask,onChange=()=>{},Peer=globalThis.RTCPeerConnection,media=globalThis.navigator?.mediaDevices,createAudio=()=>new Audio(),Stream=globalThis.MediaStream,maxDurationMs=300000}={}){Object.assign(this,{createSession,endSession,ask,onChange,Peer,media,createAudio,Stream,maxDurationMs});this.active=false;this.epoch=0;this.history=[];this.transcript='';this.answer='';this.phase='idle';this.fragments=[];this.delegations=new Set();}
 get supported(){return !!(this.Peer&&this.media?.getUserMedia);}
 emit(phase,message=''){this.phase=phase;this.onChange({engine:'live',active:this.active,phase,message,transcript:this.transcript,answer:this.answer});}
 send(event){if(this.channel?.readyState==='open')this.channel.send(JSON.stringify({...event,event_id:globalThis.crypto.randomUUID()}));}
 async start(){
  this.stop();if(!this.supported)throw Error('このブラウザでは自然な音声会話を利用できません。ChromeでREIを開いてください。');
  this.active=true;this.history=[];this.fragments=[];this.delegations.clear();this.transcript='';this.answer='';this.inputTurn=0;this.lastUserEnd=-Infinity;const epoch=++this.epoch;this.controller=new AbortController();this.emit('thinking','自然な音声会話に接続しています…');
  try{
   const stream=await this.media.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(!this.active||epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}
   this.stream=stream;const peer=this.peer=new this.Peer(),audio=this.audio=this.createAudio();audio.autoplay=true;
   peer.addEventListener('track',event=>{if(!this.active||epoch!==this.epoch)return;audio.srcObject=event.streams?.[0]||new this.Stream([event.track]);void audio.play().catch(()=>{if(this.active&&epoch===this.epoch)this.stop('ブラウザの音声再生が停止しました。会話を再開してください。');});});
   peer.addEventListener('connectionstatechange',()=>{if(this.active&&epoch===this.epoch&&['failed','disconnected','closed'].includes(peer.connectionState))this.stop('音声の接続が切れました。会話を再開できます。');});
   for(const track of stream.getAudioTracks())peer.addTrack(track,stream);
   const channel=this.channel=peer.createDataChannel('oai-events');
   channel.addEventListener('message',event=>{if(!this.active||epoch!==this.epoch)return;try{this.handle(JSON.parse(event.data),epoch);}catch{this.stop('音声サービスの応答を確認できませんでした。');}});
   channel.addEventListener('close',()=>{if(this.active&&epoch===this.epoch)this.stop('音声会話の接続が終了しました。');});
   await peer.setLocalDescription(await peer.createOffer());
   if(peer.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{peer.removeEventListener('icegatheringstatechange',changed);reject(Error('音声接続の準備に時間がかかっています。再開してください。'));},7000);const changed=()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timeout);peer.removeEventListener('icegatheringstatechange',changed);resolve();}};peer.addEventListener('icegatheringstatechange',changed);changed();});
   if(!this.active||epoch!==this.epoch)return;
   const result=await this.createSession(peer.localDescription.sdp,this.controller.signal);
   if(!this.active||epoch!==this.epoch){void this.endSession(result.id).catch(()=>{});return;}
   this.sessionId=result.id;await peer.setRemoteDescription({type:'answer',sdp:result.sdp});
   this.timer=setTimeout(()=>this.stop('5分経過したので会話を終了しました。続けるときは再開してください。'),this.maxDurationMs);
   this.readyTimer=setTimeout(()=>{if(this.active&&epoch===this.epoch&&this.phase==='thinking')this.stop('音声サービスへの接続を確認できませんでした。');},15000);
  }catch(error){if(this.active&&epoch===this.epoch)this.stop(error.name==='NotAllowedError'?'マイクを許可してから会話を再開してください。':error.message);}
 }
 handle(event,epoch=this.epoch){
  if(event.type==='session.started'){clearTimeout(this.readyTimer);this.emit('listening','自然な音声で会話できます。話している途中でも話しかけられます。');this.send({type:'session.instructions.append',delegation_id:null,content:'会話を始めます。REIというAIであることを短く伝え、何を聞きたいか自然に尋ねてください。'});return;}
  if(event.type==='session.closed'){this.stop();return;}
  if(event.type==='error'){this.stop('音声サービスで処理を続けられませんでした。APIの利用資格・残高を確認してください。');return;}
  if(['session.input_transcript.delta','session.output_transcript.delta'].includes(event.type)){
   if(typeof event.delta!=='string')return;const user=event.type==='session.input_transcript.delta';
   this.fragments.push({role:user?'user':'assistant',text:event.delta,start:event.start_ms,end:event.end_ms});this.fragments=this.fragments.slice(-150);
   const last=this.history.at(-1);
   if(user){
    // Delivery gaps are not reliable turn boundaries. Preserve fragments exactly.
    if(!this.transcript||(last&&event.start_ms-this.lastUserEnd>1500&&last.outputEnd>=this.lastUserEnd)){this.inputTurn++;this.transcript=event.delta;this.answer='';}
    else this.transcript+=event.delta;
    this.lastUserEnd=event.end_ms;
    if(this.audio)this.audio.muted=false;
    if(/^(?:会話を終了(?:して)?|音声会話を終了(?:して)?|会話終了|終わり)[。！]?$/u.test(this.transcript.trim())){this.stop();return;}
    this.emit('listening');
   }else{
    this.answer+=event.delta;
    if(this.transcript){if(!last||last.turn!==this.inputTurn)this.history.push({turn:this.inputTurn,question:this.transcript,answer:this.answer.slice(0,2000),outputEnd:event.end_ms});else {last.question=this.transcript;last.answer=this.answer.slice(0,2000);last.outputEnd=event.end_ms;}this.history=this.history.slice(-3);}
    this.emit('speaking');
   }
   return;
  }
  if(event.type==='session.delegation.created'&&event.delegation?.target==='client'){
   const id=event.delegation.id;if(typeof id!=='string'||this.delegations.has(id))return;this.delegations.add(id);
   // Build the request from transcript timing, not arbitrary model-supplied arguments.
   const relevant=this.fragments.filter(f=>f.role==='user'&&(event.offset_ms===undefined||f.start<=event.offset_ms));
   const question=this.transcript.trim()||relevant.map(f=>f.text).join('').slice(-4000);
   if(!question){this.send({type:'session.commentary.append',delegation_id:id,content:'質問の聞き取りを確認できませんでした。もう一度短く聞いてください。'});return;}
   this.send({type:'session.thinking.append',delegation_id:id,content:'SynapseConnectの選択した会社の共有記録を確認中です。まだ結果は確認できていません。'});
   const context=this.history.filter(h=>h.question!==question).map(({question,answer})=>({question,answer}));
   void this.ask(question,context,this.controller.signal).then(report=>{
    if(!this.active||epoch!==this.epoch)return;
    const content=JSON.stringify({status:report.status,answer:spokenText(report.answer).slice(0,220),uncertainties:(report.uncertainties||[]).slice(0,1).map(x=>x.slice(0,60))});
    this.send({type:'session.commentary.append',delegation_id:id,content});
   }).catch(error=>{if(this.active&&epoch===this.epoch)this.send({type:'session.commentary.append',delegation_id:id,content:'会社の記録を確認できませんでした。接続・検索範囲を画面で確認してください。'});});
  }
 }
 interrupt(){if(this.active){if(this.audio)this.audio.muted=true;this.send({type:'session.instructions.append',delegation_id:null,content:'現在の説明を止め、相手の次の質問を聞いてください。'});this.emit('listening');}}
 stop(message=''){
  if(!this.active&&!this.peer&&!this.sessionId)return;
  const peer=this.peer,channel=this.channel,sessionId=this.sessionId;this.active=false;this.epoch++;this.controller?.abort();clearTimeout(this.timer);clearTimeout(this.readyTimer);
  this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;this.audio?.pause();if(this.audio)this.audio.srcObject=null;this.audio=null;this.peer=null;this.channel=null;this.sessionId=null;
  if(channel?.readyState==='open')try{channel.send(JSON.stringify({type:'session.close'}));}catch{}
  const cleanup=()=>{channel?.close();peer?.close();};
  if(sessionId){const timeout=setTimeout(cleanup,1500);void this.endSession(sessionId).catch(()=>{}).finally(()=>{clearTimeout(timeout);cleanup();});}else cleanup();
  this.emit(message?'error':'idle',message);
 }
}
