export function spokenText(value) {
  return String(value).replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g,'$1')
    .replace(/https?:\/\/\S+/g,'')
    .replace(/(?:記録ID|出典ID|recordId)\s*[:：]?\s*[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}/gi,'')
    .replace(/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}/gi,'')
    .replace(/[（(]\s*[）)]/g,'').replace(/[*`#]/g,'')
    .replace(/^\s*[-・]\s+/gm,'').replace(/\s+/g,' ').trim();
}
export function speechChunks(value,max=380) {
  const text=spokenText(value),parts=text.match(/[^。！？]+[。！？]*|[。！？]+/g)||[];
  const chunks=[];let current='';
  for(let part of parts) {
    if(current&&Array.from(current+part).length>max){chunks.push(current);current='';}
    while(Array.from(part).length>max){const characters=Array.from(part),head=characters.slice(0,max).join(''),comma=head.lastIndexOf('、');const cut=comma>max/2?Array.from(head.slice(0,comma+1)).length:max;chunks.push(characters.slice(0,cut).join(''));part=characters.slice(cut).join('');}
    current+=part;
  }
  if(current)chunks.push(current);return chunks;
}
export function japaneseVoice(voices,preferred='') {
  const available=voices.filter(voice=>/^ja(?:-|_)/i.test(voice.lang));
  return available.find(voice=>voice.voiceURI===preferred)||available.find(voice=>voice.default)||available[0];
}
export class VoiceConversation {
  constructor({Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition,synthesis=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance,ask,onChange=()=>{},restartDelay=700,answerTimeoutMs=180000}) {
    Object.assign(this,{Recognition,synthesis,Utterance,ask,onChange,restartDelay,answerTimeoutMs});
    this.active=false;this.phase='idle';this.epoch=0;this.history=[];this.transcript='';this.answer='';this.emptyTurns=0;
  }
  get supported(){return !!(this.Recognition&&(this.localSpeak||(this.synthesis&&this.Utterance)));}
  emit(phase,message=''){this.phase=phase;this.onChange({active:this.active,phase,message,transcript:this.transcript,answer:this.answer});}
  start() {
    if(!this.supported)throw new Error('このブラウザは音声会話に対応していません。ChromeでREIを開いてください。');
    this.stop();this.active=true;this.transcript='';this.answer='';this.emptyTurns=0;
    if(!this.localSpeak)this.synthesis.speak(new this.Utterance(''));
    this.listen();
  }
  stop(message='') {
    this.active=false;this.epoch++;clearTimeout(this.restartTimer);clearTimeout(this.answerTimer);clearTimeout(this.progressTimer);this.controller?.abort();
    if(this.recognition){this.recognition.onend=null;this.recognition.onerror=null;try{this.recognition.abort();}catch{}this.recognition=null;}
    this.synthesis?.cancel();this.emit(message?'error':'idle',message);
  }
  listen() {
    if(!this.active)return;
    const epoch=++this.epoch,recognition=new this.Recognition();this.recognition=recognition;
    recognition.lang='ja-JP';recognition.continuous=false;recognition.interimResults=true;recognition.maxAlternatives=1;
    let question='';this.transcript='';this.emit('listening');
    recognition.onresult=event=>{
      if(!this.active||epoch!==this.epoch)return;
      const finals=[],all=[];
      for(let index=0;index<event.results.length;index++){const result=event.results[index];all.push(result[0].transcript);if(result.isFinal)finals.push(result[0].transcript);}
      question=finals.join(' ').trim();this.transcript=all.join(' ').trim();this.emit('listening');
    };
    recognition.onerror=event=>{
      if(!this.active||epoch!==this.epoch||event.error==='no-speech'||event.error==='aborted')return;
      const message=event.error==='not-allowed'||event.error==='service-not-allowed'?'マイクの利用が許可されていません。ブラウザのマイク設定を確認してください。':event.error==='network'?'音声認識のサービスへ接続できません。ネットワークを確認して再開してください。':'音声を受け取れませんでした。マイクを確認して再開してください。';
      this.stop(message);
    };
    recognition.onend=()=>{
      if(!this.active||epoch!==this.epoch||this.recognition!==recognition)return;
      this.recognition=null;
      if(/^(?:会話を終了(?:して)?|音声会話を終了(?:して)?|会話終了|終わり)[。！]?$/u.test(question))this.stop();
      else if(question){this.emptyTurns=0;void this.respond(question,epoch);}
      else this.restartTimer=setTimeout(()=>{if(this.active&&epoch===this.epoch)this.listen();},this.restartDelay);
    };
    try{recognition.start();}catch{this.stop('音声認識を開始できませんでした。マイクを使っている別の会話を終了して再開してください。');}
  }
  async respond(question,epoch) {
    this.transcript=question;this.emit('thinking');this.controller=new AbortController();
    const progressTimer=this.progressTimer=setTimeout(()=>{if(this.active&&epoch===this.epoch)this.emit('thinking','情報源を確認しています。回答まで1〜2分かかる場合があります。');},20000);
    const answerTimer=this.answerTimer=setTimeout(()=>{if(this.active&&epoch===this.epoch)this.stop('回答の確認に時間がかかっています。会社の記憶の画面で結果を確認し、会話を再開してください。');},this.answerTimeoutMs);
    try {
      const answer=await this.ask(question,this.history.slice(-3),this.controller.signal);
      if(!this.active||epoch!==this.epoch)return;
      this.answer=String(answer);this.history.push({question,answer:this.answer.slice(0,2000)});
      this.history=this.history.slice(-3);this.say(this.answer);
    } catch(error){if(this.active&&epoch===this.epoch)this.stop(error.message||'回答を確認できませんでした。');}
    finally {clearTimeout(answerTimer);clearTimeout(progressTimer);}
  }
  say(answer) {
    const epoch=++this.epoch;
    if(this.localSpeak){
      this.controller=new AbortController();this.emit('speaking','声を準備しています');
      const signal=this.controller.signal;
      void (this.localReply?this.localReply(spokenText(answer),signal):(async()=>{for(const chunk of speechChunks(answer,380)){if(signal.aborted)return;await this.localSpeak(chunk,signal);}})()).then(()=>{
        if(this.active&&epoch===this.epoch)this.listen();
      }).catch(error=>{if(this.active&&epoch===this.epoch){this.emit('speaking',error.message||'音声を再生できませんでした');this.restartTimer=setTimeout(()=>{if(this.active&&epoch===this.epoch)this.listen();},1500);}});
      return;
    }
    const chunks=speechChunks(answer);let index=0;
    this.emit('speaking');
    const next=()=>{
      if(!this.active||epoch!==this.epoch)return;
      if(index>=chunks.length){this.listen();return;}
      const utterance=new this.Utterance(chunks[index++]);utterance.lang='ja-JP';utterance.rate=1.02;
      const voice=japaneseVoice(this.synthesis.getVoices(),this.voiceURI);if(voice)utterance.voice=voice;
      utterance.onend=next;utterance.onerror=()=>{if(this.active&&epoch===this.epoch)this.stop('読み上げを続けられませんでした。回答は会社の記憶の画面で確認できます。');};
      this.synthesis.speak(utterance);
    };
    next();
  }
  interrupt(){if(this.active&&this.phase==='speaking'){this.epoch++;this.controller?.abort();this.synthesis?.cancel();this.listen();}}
}
