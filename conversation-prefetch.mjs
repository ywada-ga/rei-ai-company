import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {one,run,all,transaction} from './storage.mjs';
import {mcpData} from './load-synapse.mjs';
import {readAdditions,readConcurrent} from './conversation-updates.mjs';

// Private, bounded stored source bodies. Never return bodies from status().
export function prefetchScopeKey(scope){
  if(typeof scope?.userId!=='string'||!scope.userId||!['owner','admin'].includes(scope.role)||typeof scope.integration!=='string'||!scope.integration||!Array.isArray(scope.groups)||!scope.groups.length||scope.groups.length>64||scope.groups.some(g=>typeof g.id!=='string'||!g.id)||new Set(scope.groups.map(g=>g.id)).size!==scope.groups.length)throw new Error('Invalid prefetch scope');
  return createHash('sha256').update(JSON.stringify([scope.userId,scope.role,scope.integration,[...scope.groups].map(g=>[g.id,g.personal===true]).sort((a,b)=>a[0].localeCompare(b[0]))])).digest('hex');
}
export function prefetchAuthorized(catalog,scope){
  const data=mcpData(catalog);
  if(catalog?.isError||data?.truncated||data?.coverage?.complete!==true||!Array.isArray(data.groups))return false;
  const ids=data.groups.map(g=>g.group_id);
  if(new Set(ids).size!==ids.length)return false;
  return scope.groups.every(selected=>{
    const group=data.groups.find(g=>g.group_id===selected.id);
    return group?.status==='published'&&['personal','organizational','library'].includes(group.classification)&&
      (group.classification==='personal')===(selected.personal===true)&&(group.classification!=='personal'||scope.role==='owner');
  });
}
function checkedRecord(result,row,scope,at){
  const data=mcpData(result),episode=data?.episode;
  if(result?.isError||data?.truncated||data?.coverage?.complete!==true||data.deleted===true||data.is_latest_revision===false||data.invalid_at||episode?.uuid!==row.uuid||episode.group_id!==row.group_id||!scope.groups.some(g=>g.id===episode.group_id)||episode.content_truncated||episode.content_representation==='bounded_prefix'||typeof episode.content!=='string'||!episode.content.trim()||episode.deleted===true||episode.is_latest_revision===false||episode.invalid_at||!['obsidian','text','manual','agent','mcp'].includes(episode.origin)||!episode.recorded_at||(!episode.source_ref&&!(episode.origin==='mcp'&&episode.author_subject)))throw new Error('Source body unavailable');
  // Keep only required source fields; transport details and credentials stay out.
  const fields=['uuid','group_id','name','doc_name','content','origin','recorded_at','created_at','source_ref','author_subject','doc_sha'];
  return {addedAt:row.created_at,fetchedAt:at,episode:Object.fromEntries(fields.filter(k=>episode[k]!==undefined).map(k=>[k,episode[k]]))};
}
// Reserve bounded yesterday coverage even when today's activity fills the cache.
// Selection is storage policy, not a relevance ranking or complete daily read.
export function prefetchCandidates(rows,at,maxRecords,preferredIds=[]){
  const end=Math.floor((at+9*3600000)/86400000)*86400000-9*3600000,start=end-86400000;
  const reserved=rows.filter(row=>{const t=Date.parse(row.created_at);return t>=start&&t<end;}).slice(0,Math.floor(maxRecords/4));
  const preferred=preferredIds.slice(0,8).map(id=>rows.find(row=>row.uuid===id)).filter(Boolean);
  const first=[...preferred,...reserved.filter(row=>!preferred.some(p=>p.uuid===row.uuid))].slice(0,maxRecords);
  const ids=new Set(first.map(row=>row.uuid));
  return [...first,...rows.filter(row=>!ids.has(row.uuid)).slice(0,maxRecords-first.length)].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
}
export class ConversationPrefetch {
  constructor(db,{now=Date.now,maxAgeMs=600000,intervalMs=300000,maxRecords=64,maxBytes=4*1024*1024,maxScopes=16}={}){
    Object.assign(this,{db,now,maxAgeMs,intervalMs,maxRecords,maxBytes,maxScopes});this.active=new Map();
    this.prune();
  }
  prune(){
    for(const row of all(this.db,"SELECT key,value FROM settings WHERE key LIKE 'conversation-prefetch:%'")){
      let value;try{value=JSON.parse(row.value);}catch{}
      const age=this.now()-value?.checkedAt;
      if(!value||!Number.isSafeInteger(value.checkedAt)||age<0||age>this.maxAgeMs)run(this.db,'DELETE FROM settings WHERE key=?',row.key);
    }
  }
  storageKey(scope){return 'conversation-prefetch:'+prefetchScopeKey(scope);}
  status(scope){
    const key=this.storageKey(scope),entry=this.active.get(key);let value;
    try{value=JSON.parse(one(this.db,'SELECT value FROM settings WHERE key=?',key)?.value||'null');}catch{}
    const age=value?this.now()-value.checkedAt:null;
    const usable=!!value&&value.version===1&&value.scopeKey===key&&Number.isSafeInteger(value.checkedAt)&&Number.isSafeInteger(value.ledgerCount)&&value.ledgerCount>=0&&['complete','limited'].includes(value.bodyCoverage)&&Array.isArray(value.records)&&value.records.length<=this.maxRecords&&age>=0&&age<=this.maxAgeMs&&entry?.failed!==true;
    return {active:!!entry,state:entry?.pending?'syncing':entry?.failed?'unavailable':usable?'ready':value?'expired':'empty',usable,checkedAt:usable?value.checkedAt:null,ageMs:usable?age:null,recordCount:usable?value.records.length:0,ledgerCount:usable?value.ledgerCount:0,bodyCoverage:usable?value.bodyCoverage:null,syncDiagnostics:entry?.timing?{...entry.timing}:null};
  }
  snapshot(scope,catalog){
    // Callers must supply a new authenticated catalog on each question.
    if(!prefetchAuthorized(catalog,scope)){this.invalidate(scope);return null;}
    if(!this.status(scope).usable)return null;
    const value=JSON.parse(one(this.db,'SELECT value FROM settings WHERE key=?',this.storageKey(scope)).value);
    if(value.records.some(record=>!record?.episode?.uuid||!scope.groups.some(g=>g.id===record.episode.group_id)||typeof record.episode.content!=='string'||!Number.isFinite(record.fetchedAt))){this.invalidate(scope);return null;}
    return structuredClone(value);
  }
  rememberVerified(scope,result,catalog){
    // Reuse only freshly assessed full bodies, within a still-usable same scope.
    // Never renew the snapshot clock or trust previous assistant text as evidence.
    const key=this.storageKey(scope),entry=this.active.get(key);
    if(entry?.pending||!prefetchAuthorized(catalog,scope)||!this.status(scope).usable||result?.synapseRead!==true||!['supported','partial'].includes(result.evidenceStatus)||!Array.isArray(result.sources))return false;
    const value=JSON.parse(one(this.db,'SELECT value FROM settings WHERE key=?',key).value),fresh=[];
    for(const source of result.sources.slice(0,8)){
      const evidence=(result.evidence||[]).find(item=>item.tool==='get_episode'&&item.uuid===source.uuid);
      const episode=mcpData(evidence?.result)?.episode;
      if(!episode||!Number.isFinite(Date.parse(episode.created_at)))return false;
      try{fresh.push(checkedRecord(evidence.result,{uuid:source.uuid,group_id:episode.group_id,created_at:episode.created_at},scope,this.now()));}catch{return false;}
    }
    if(!fresh.length||new Set(fresh.map(r=>r.episode.uuid)).size!==fresh.length)return false;
    const preferredIds=[...new Set([...fresh.map(r=>r.episode.uuid),...(value.preferredIds||[])])].slice(0,8);
    const records=[...fresh,...value.records.filter(r=>!fresh.some(f=>f.episode.uuid===r.episode.uuid))].slice(0,this.maxRecords);
    const next={...value,records,preferredIds,bodyCoverage:'limited'};
    const encoded=JSON.stringify(next);if(Buffer.byteLength(encoded)>this.maxBytes)return false;
    run(this.db,'UPDATE settings SET value=? WHERE key=?',encoded,key);return true;
  }
  invalidate(scope){
    const key=this.storageKey(scope),entry=this.active.get(key);
    if(entry){entry.generation++;entry.controller?.abort();entry.failed=true;}
    run(this.db,'DELETE FROM settings WHERE key=?',key);
  }
  activate(scope,io){
    const key=this.storageKey(scope);
    // A user's old role/scope/connection must not continue collecting bodies.
    for(const [oldKey,old]of this.active)if(old.scope.userId===scope.userId&&oldKey!==key){this.invalidate(old.scope);this.active.delete(oldKey);}
    if(!this.active.has(key)){
      if(this.active.size>=this.maxScopes){const oldest=this.active.values().next().value;this.invalidate(oldest.scope);this.active.delete(this.storageKey(oldest.scope));}
      const preserved=this.status(scope);
      this.active.set(key,{scope:structuredClone(scope),io,cursors:new Map(),generation:0,lastAttempt:preserved.usable?preserved.checkedAt:null,failed:false});
    }
    const entry=this.active.get(key);entry.io=io;
    if(entry.pending)return entry.pending;
    if(entry.lastAttempt!==null&&this.now()-entry.lastAttempt<this.intervalMs)return Promise.resolve(this.status(scope));
    return this.sync(scope);
  }
  async sync(scope){
    const key=this.storageKey(scope),entry=this.active.get(key);if(!entry)throw new Error('Scope not activated');if(entry.pending)return entry.pending;
    entry.lastAttempt=this.now();entry.controller=new AbortController();const signal=entry.controller.signal,generation=entry.generation;
    const idle=async()=>{
      if(!entry.io.isBusy?.())return;
      const waiting=this.now();
      try{while(entry.io.isBusy?.()){if(signal.aborted)throw new Error('Scope changed');await delay(100,undefined,{signal});}}
      finally{entry.timing.yieldMs=(entry.timing.yieldMs||0)+Math.max(0,this.now()-waiting);}
    };
    const current=()=>!signal.aborted&&entry.generation===generation&&prefetchScopeKey(entry.io.currentScope())===prefetchScopeKey(scope);
    const started=this.now();entry.timing={phase:'catalog',totalMs:null};
    const timed=async(phase,operation)=>{entry.timing.phase=phase;const at=this.now();try{return await operation();}finally{entry.timing[phase+'Ms']=Math.max(0,this.now()-at);}};
    const pending=(async()=>{
      try{
        if(!current())throw new Error('Scope changed');
        await idle();
        const catalog=await timed('catalog',()=>entry.io.catalog(signal));
        if(!current()||!prefetchAuthorized(catalog,scope))throw new Error('Scope unavailable');
        const update=await timed('ledger',()=>readAdditions({groups:scope.groups,window:{start:0,end:Number.MAX_SAFE_INTEGER},call:entry.io.call,signal,cache:entry.cursors}));
        if(!current()||!update.complete)throw new Error('Incomplete ledger');
        // Too much cursor metadata disables prefetch instead of growing indefinitely.
        if(update.rows.length>10000)throw new Error('Ledger too large');
        let preferredIds=[];try{preferredIds=JSON.parse(one(this.db,'SELECT value FROM settings WHERE key=?',key)?.value||'null')?.preferredIds||[];}catch{}
        const at=this.now(),candidates=prefetchCandidates(update.rows,at,this.maxRecords,preferredIds);
        // Counts observe caller overlap, not server execution. Summed durations overlap.
        let activeReads=0;
        Object.assign(entry.timing,{bodyReadCount:0,bodyReadPeak:0,bodyReadTotalMs:0,bodyReadMaxMs:0,bodyTransportCount:0,bodyConnectMs:0,bodyRequestMs:0});
        const records=await timed('bodies',()=>readConcurrent(candidates,async row=>{
          await idle();if(!current())throw new Error('Scope changed');
          const readStarted=this.now();entry.timing.bodyReadCount++;activeReads++;
          entry.timing.bodyReadPeak=Math.max(entry.timing.bodyReadPeak,activeReads);
          try{
            const result=await entry.io.call('get_episode',{uuid:row.uuid,group_ids:[row.group_id]},signal);
            const timing=result?.reiMcpTiming;
            if(Number.isSafeInteger(timing?.connectMs)&&timing.connectMs>=0&&Number.isSafeInteger(timing?.requestMs)&&timing.requestMs>=0){
              entry.timing.bodyTransportCount++;entry.timing.bodyConnectMs+=timing.connectMs;entry.timing.bodyRequestMs+=timing.requestMs;
            }
            return checkedRecord(result,row,scope,at);
          }finally{
            activeReads--;const elapsed=Math.max(0,this.now()-readStarted);
            entry.timing.bodyReadTotalMs+=elapsed;entry.timing.bodyReadMaxMs=Math.max(entry.timing.bodyReadMaxMs,elapsed);
          }
        },{concurrency:6,signal}));
        await idle();
        // Recheck remote permission after the reads, before persisting any source.
        if(!current()||!prefetchAuthorized(await timed('permission',()=>entry.io.catalog(signal)),scope)||!current())throw new Error('Scope changed');
        const value={version:1,scopeKey:key,checkedAt:at,records,preferredIds:preferredIds.filter(id=>records.some(r=>r.episode.uuid===id)).slice(0,8),ledgerCount:update.rows.length,bodyCoverage:records.length===update.rows.length?'complete':'limited'};
        const encoded=JSON.stringify(value);if(Buffer.byteLength(encoded)>this.maxBytes)throw new Error('Index too large');
        transaction(this.db,()=>{
          run(this.db,'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,encoded);
          const keys=all(this.db,"SELECT key FROM settings WHERE key LIKE 'conversation-prefetch:%' ORDER BY rowid DESC");
          for(const row of keys.slice(this.maxScopes))run(this.db,'DELETE FROM settings WHERE key=?',row.key);
        });entry.failed=false;entry.timing.phase='complete';
      }catch{
        // Never serve an older snapshot after failed sync, revoke or partial reads.
        entry.failed=true;entry.timing.phase='failed';entry.cursors.clear();if(this.active.get(key)===entry&&entry.generation===generation)run(this.db,'DELETE FROM settings WHERE key=?',key);
      }
      entry.timing.totalMs=Math.max(0,this.now()-started);
      return this.status(scope);
    })();entry.pending=pending;
    try{return await pending;}finally{if(entry.pending===pending)entry.pending=null;}
  }
  async tick(){this.prune();await Promise.all([...this.active.values()].map(entry=>this.activate(entry.scope,entry.io)));}
  close(){for(const entry of this.active.values()){entry.generation++;entry.controller?.abort();}this.active.clear();}
}
