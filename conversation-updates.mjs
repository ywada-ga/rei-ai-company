import {randomUUID} from 'node:crypto';
import {mcpData,unavailableGroups} from './load-synapse.mjs';

// Refill each available slot immediately; retain ledger order for evidence review.
// Drain in-flight reads on failure so a subsequent turn cannot overlap orphaned reads.
export async function readConcurrent(items,read,{concurrency=6,signal}={}){
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>16)throw new Error('Invalid read concurrency');
  const results=new Array(items.length);let next=0,failure;
  const workers=Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(next<items.length&&!failure){
      if(signal?.aborted){failure=new Error('会話を中断しました');break;}
      const index=next++;
      try{results[index]=await read(items[index],index);}
      catch(error){failure??=error;}
    }
  });
  await Promise.all(workers);
  if(signal?.aborted)throw new Error('会話を中断しました');
  if(failure)throw failure;
  return results;
}

export function additionWindow(question,now=Date.now()){
  if(!/(追加|登録|新情報|新しい情報|新たな情報|更新)/u.test(question)||!/(今日|本日|きょう|昨日)/u.test(question))return null;
  const offset=9*3600000,day=86400000;
  const start=Math.floor((now+offset)/day)*day-offset-(/昨日/u.test(question)?day:0);
  return {start,end:start+day,timeZone:'Asia/Tokyo',date:new Date(start+offset).toISOString().slice(0,10)};
}

// Opaque server-issued cursors and scoped IDs only. No cached bodies or bookmark writes.
export async function readAdditions({groups,window,call,signal,cache=new Map(),maxPages=8}){
  const reports=await Promise.all(groups.map(async group=>{
    const key=JSON.stringify([group.id,window.start,window.end]);let state=cache.get(key);
    if(!state)state={rows:new Map(),cursor:null,complete:false,stream:'rei-ro-'+randomUUID()};
    let complete=false,denied=false,pages=0,reasons=[];
    while(pages<maxPages){
      if(signal?.aborted)throw new Error('会話を中断しました');
      const args={group_id:group.id,group_ids:[group.id],advance:false,limit:1000,stream:state.stream,...(state.cursor?{cursor:state.cursor}:{start:'beginning'})};
      const result=await call('get_updates',args,signal);pages++;
      if(result.isError)throw new Error('Synapse Connectの追加履歴を取得できませんでした。');
      const data=mcpData(result);reasons=data?.coverage?.reasons||[];
      denied=unavailableGroups(result,[group]).length>0||reasons.includes('group_not_registered');
      if(denied)break;
      if(!data||!Array.isArray(data.episodes)||reasons.some(r=>!['no_match','limit_reached'].includes(r)))throw new Error('追加履歴の確認範囲を検証できませんでした。');
      const cursorBefore=state.cursor;
      for(const row of data.episodes){
        if(row.group_id!==group.id||typeof row.episode_uuid!=='string')throw new Error('追加履歴の検索範囲が一致しません。');
        const at=Date.parse(row.created_at);
        if(!Number.isFinite(at))throw new Error('追加日時を確認できませんでした。');
        if(at>=window.start&&at<window.end)state.rows.set(row.episode_uuid,{uuid:row.episode_uuid,group_id:row.group_id,created_at:row.created_at});
      }
      if(typeof data.next_cursor==='string'&&data.next_cursor)state.cursor=data.next_cursor;
      if(data.truncated===false&&data.coverage?.complete===true){complete=true;break;}
      if(!state.cursor||state.cursor===cursorBefore)break;
    }
    if(denied)return {groupId:group.id,rows:[],complete:false,denied:true,pages,reasons};
    state.complete=complete;
    if(cache.size>=64&&!cache.has(key))cache.delete(cache.keys().next().value);
    cache.set(key,state);
    return {groupId:group.id,groupName:group.name,personal:group.personal===true,rows:[...state.rows.values()],complete,denied:false,pages,reasons};
  }));
  const rows=[...new Map(reports.flatMap(r=>r.rows).map(row=>[row.uuid,row])).values()].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
  return {rows,complete:reports.every(r=>r.complete&&!r.denied),reports};
}
