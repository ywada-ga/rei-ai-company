import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ConversationPrefetch,prefetchScopeKey,prefetchAuthorized,prefetchCandidates} from '../conversation-prefetch.mjs';

const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
let now=1000000,denied=false,incomplete=false,missing=false,changed=false,calls=0,revision=0;
const scope={userId:'fixture-owner',role:'owner',integration:'fixture-connection',groups:[{id:'fixture-private',personal:true}]};
const other={...scope,userId:'fixture-other'};
const reply=data=>({structuredContent:data});
const catalog=()=>reply({groups:denied?[]:[{group_id:'fixture-private',classification:'personal',status:'published'}],coverage:{complete:true},truncated:false});
const io={currentScope:()=>changed?other:scope,catalog:async()=>catalog(),call:async(tool,args)=>{
  calls++;if(tool==='get_updates'){assert.equal(args.advance,false);assert.ok(args.stream.startsWith('rei-ro-'));return reply({episodes:[{episode_uuid:'fixture-record',group_id:'fixture-private',created_at:new Date(now-10000).toISOString()}],next_cursor:'opaque-fixture',truncated:incomplete,coverage:{complete:!incomplete,reasons:incomplete?['limit_reached']:[]}});}
  assert.equal(tool,'get_episode');assert.deepEqual(args.group_ids,['fixture-private']);return missing?{isError:true}:reply({episode:{uuid:'fixture-record',group_id:'fixture-private',content:'SYNTHETIC_BODY_'+revision,origin:'manual',source_ref:'fixture only',recorded_at:new Date(now-10000).toISOString()},coverage:{complete:true},truncated:false});
}};
const cache=new ConversationPrefetch(db,{now:()=>now,intervalMs:500,maxAgeMs:1000});
assert.notEqual(prefetchScopeKey(scope),prefetchScopeKey(other));assert.notEqual(prefetchScopeKey(scope),prefetchScopeKey({...scope,role:'admin'}));
assert.equal(prefetchAuthorized(catalog(),{...scope,role:'admin'}),false);
assert.equal(prefetchAuthorized(catalog(),{...scope,groups:[{id:'fixture-private',personal:false}]}),false);
assert.equal(prefetchAuthorized(reply({groups:[],coverage:{complete:false}}),scope),false);
assert.equal(cache.status(scope).state,'empty');
await cache.activate(scope,io);assert.equal(cache.status(scope).state,'ready');
assert.equal(cache.snapshot(scope,catalog()).records[0].episode.content,'SYNTHETIC_BODY_0');
assert.equal(cache.snapshot(other,catalog()),null);assert.ok(!JSON.stringify(cache.status(scope)).includes('SYNTHETIC_BODY'));
const initialCalls=calls;await cache.activate(scope,io);assert.equal(calls,initialCalls,'duplicate preparation must not sync again');
const reload=new ConversationPrefetch(db,{now:()=>now,maxAgeMs:1000});assert.equal(reload.snapshot(scope,catalog()).records.length,1,'persisted source survives restart');
await reload.activate(scope,io);assert.equal(calls,initialCalls,'restart with a usable persisted snapshot must not duplicate full synchronization');
now+=1001;assert.equal(cache.snapshot(scope,catalog()),null,'expired source cannot be served');
cache.prune();assert.equal(db.prepare('SELECT count(*) AS n FROM settings').get().n,0,'expired copied source is removed from persistent storage');
revision++;await cache.activate(scope,io);assert.equal(cache.snapshot(scope,catalog()).records[0].episode.content,'SYNTHETIC_BODY_1','retained source is freshly reread for revisions');
now+=501;missing=true;await cache.activate(scope,io);assert.equal(cache.status(scope).state,'unavailable');assert.equal(cache.snapshot(scope,catalog()),null,'deleted/failed source cannot leave old data usable');
missing=false;now+=501;await cache.activate(scope,io);denied=true;assert.equal(cache.snapshot(scope,catalog()),null,'fresh catalog revocation erases snapshot');
denied=false;now+=501;await cache.activate(scope,io);assert.equal(cache.status(scope).usable,true);
now+=501;incomplete=true;await cache.activate(scope,io);assert.equal(cache.status(scope).usable,false,'incomplete ledger invalidates previous snapshot');
incomplete=false;changed=true;now+=501;await cache.activate(scope,io);assert.equal(cache.status(scope).usable,false,'scope changing during synchronization prevents commit');changed=false;
// A blocked source read must be single-flight and an abort must drain it.
let release,reads=0;
const blocking={...io,call:async(tool,args,signal)=>{if(tool==='get_episode'){reads++;await new Promise(r=>release=r);}return io.call(tool,args,signal);}};
now+=501;const pending=cache.activate(scope,blocking);await new Promise(setImmediate);const duplicate=cache.activate(scope,blocking);assert.equal(reads,1);cache.invalidate(scope);release();await Promise.all([pending,duplicate]);assert.equal(cache.status(scope).usable,false);
// Cap bodies while retaining truthful ledger coverage and refresh old bodies.
const limited=new ConversationPrefetch(db,{now:()=>now,maxRecords:0});await limited.activate(other,{...io,currentScope:()=>other});assert.equal(limited.status(other).bodyCoverage,'limited');assert.equal(limited.status(other).recordCount,0);
// Explicit invalid state anywhere in the response must erase a prior usable snapshot.
for(const flag of [{deleted:true},{is_latest_revision:false},{invalid_at:'2026-10-10T00:00:00Z'}]){
  for(const placement of ['root','episode']){
    now+=501;await cache.activate(scope,io);assert.equal(cache.status(scope).usable,true);
    now+=501;
    const invalid={...io,call:async(tool,args,signal)=>{
      const result=await io.call(tool,args,signal);
      if(tool==='get_episode')Object.assign(placement==='root'?result.structuredContent:result.structuredContent.episode,flag);
      return result;
    }};
    await cache.activate(scope,invalid);
    assert.equal(cache.snapshot(scope,catalog()),null,placement+' explicit invalid body cannot leave a provisional snapshot');
    assert.equal(db.prepare('SELECT count(*) AS n FROM settings WHERE key=?').get(cache.storageKey(scope)).n,0,'invalid source clears copied body');
  }
}
cache.close();reload.close();limited.close();db.close();
console.log('PASS scoped persistent prefetch, fresh permission gates, expiry, revision/deletion failure, single-flight and cancellation');

const current=Date.parse('2026-10-09T03:00:00Z');
const busyToday=Array.from({length:80},(_,i)=>({uuid:'today-'+i,created_at:new Date(current-i*1000).toISOString()}));
const previousDay=Array.from({length:42},(_,i)=>({uuid:'yesterday-'+i,created_at:new Date(current-86400000-i*1000).toISOString()}));
const balanced=prefetchCandidates([...busyToday,...previousDay],current,64);
assert.equal(balanced.length,64);assert.equal(balanced.filter(r=>r.uuid.startsWith('yesterday')).length,16);
assert.equal(new Set(balanced.map(r=>r.uuid)).size,64);assert.equal(balanced[0].uuid,'today-0');
assert.equal(prefetchCandidates(busyToday,current,64).length,64);assert.deepEqual(prefetchCandidates(previousDay,current,0),[]);
console.log('PASS busy current day cannot evict all yesterday sources; body cap and ordering remain bounded');

// Numeric phase timings include final permission and failed body reads without source data.
const timingDb=new DatabaseSync(':memory:');timingDb.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
let timingNow=2000000,failBody=false;
const timingCache=new ConversationPrefetch(timingDb,{now:()=>timingNow,intervalMs:1});
const timingIo={...io,catalog:async()=>{timingNow+=10;return catalog();},call:async(tool,args)=>{timingNow+=tool==='get_updates'?20:30;if(failBody&&tool==='get_episode')throw Error('SYNTHETIC_BODY_SECRET');return io.call(tool,args);}};
await timingCache.activate(scope,timingIo);
assert.deepEqual(timingCache.status(scope).syncDiagnostics,{phase:'complete',totalMs:70,catalogMs:10,ledgerMs:20,bodiesMs:30,permissionMs:10});
failBody=true;timingNow+=2;await timingCache.activate(scope,timingIo);
assert.deepEqual(timingCache.status(scope).syncDiagnostics,{phase:'failed',totalMs:60,catalogMs:10,ledgerMs:20,bodiesMs:30});
assert.equal(timingCache.status(scope).usable,false);assert.ok(!JSON.stringify(timingCache.status(scope)).includes('SECRET'));
timingCache.close();timingDb.close();console.log('PASS source-free numeric preparation phases, final permission and failure timing');
