import {CONVERSATION_PROGRESS,additionsProgress} from './conversation-progress.js';
export async function readConversationStream(response,{signal,onDelta=()=>{},onReceipt=()=>{}}={}){
  if(!response.ok){let value;try{value=await response.json();}catch{}throw new Error(value?.error||'会話に接続できませんでした');}
  let buffer='',done=null;const decoder=new TextDecoder();
  const consume=line=>{if(!line.trim())return;if(done)throw new Error('返答の完了形式を確認できません');const event=JSON.parse(line);
    if(event.type==='error')throw Object.assign(new Error(event.message||'返答が中断されました'),{conversationDiagnostics:event.diagnostics||null});
    if(event.type==='receipt'){if(typeof event.text!=='string'||event.text.length>200)throw new Error('受け答えの形式が不正です');onReceipt?.(event.text);}
    else if(event.type==='progress'){if(event.stage==='additions'?event.text!==additionsProgress(event.count):!Object.hasOwn(CONVERSATION_PROGRESS,event.stage)||event.text!==CONVERSATION_PROGRESS[event.stage])throw new Error('進捗案内の形式が不正です');onReceipt?.(event.text,{type:'progress',stage:event.stage});}
    else if(event.type==='delta'){if(typeof event.text!=='string')throw new Error('返答の形式が不正です');onDelta?.(event.text);}
    else if(event.type==='done'){if(typeof event.result?.answer!=='string')throw new Error('返答の形式が不正です');done=event.result;}
  };
  for await(const bytes of response.body){if(signal?.aborted)throw new Error('会話を中断しました');buffer+=decoder.decode(bytes,{stream:true});if(buffer.length>200000)throw new Error('返答が長すぎます');let split;while((split=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,split));buffer=buffer.slice(split+1);}}
  buffer+=decoder.decode();if(buffer.trim())consume(buffer);if(!done)throw new Error('返答が途中で切れました');return done;
}
