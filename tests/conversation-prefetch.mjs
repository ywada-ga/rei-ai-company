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
assert.deepEqual(timingCache.status(scope).syncDiagnostics,{phase:'complete',totalMs:70,catalogMs:10,ledgerMs:20,bodiesMs:30,permissionMs:10,bodyReadCount:1,bodyReadPeak:1,bodyReadTotalMs:30,bodyReadMaxMs:30,bodyTransportCount:0,bodyConnectMs:0,bodyRequestMs:0});
failBody=true;timingNow+=2;await timingCache.activate(scope,timingIo);
assert.deepEqual(timingCache.status(scope).syncDiagnostics,{phase:'failed',totalMs:60,catalogMs:10,ledgerMs:20,bodiesMs:30,bodyReadCount:1,bodyReadPeak:1,bodyReadTotalMs:30,bodyReadMaxMs:30,bodyTransportCount:0,bodyConnectMs:0,bodyRequestMs:0});
assert.equal(timingCache.status(scope).usable,false);assert.ok(!JSON.stringify(timingCache.status(scope)).includes('SECRET'));
timingCache.close();timingDb.close();console.log('PASS source-free numeric preparation phases, final permission and failure timing');

// Actual overlap must be observable without publishing record identifiers or bodies.
const overlapDb=new DatabaseSync(':memory:');overlapDb.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
const overlapCache=new ConversationPrefetch(overlapDb);let releases=[],startedReads=0;
const overlapIo={currentScope:()=>scope,catalog:async()=>catalog(),call:async(tool,args)=>{
  if(tool==='get_updates')return reply({episodes:Array.from({length:7},(_,i)=>({episode_uuid:'overlap-'+i,group_id:'fixture-private',created_at:new Date().toISOString()})),coverage:{complete:true},truncated:false});
  startedReads++;await new Promise(resolve=>releases.push(resolve));
  return {...reply({episode:{uuid:args.uuid,group_id:'fixture-private',content:'SYNTHETIC_PRIVATE_BODY',origin:'manual',source_ref:'fixture',recorded_at:new Date().toISOString()},coverage:{complete:true},truncated:false}),reiMcpTiming:{connectMs:2,requestMs:3}};
}};
const overlapPending=overlapCache.activate(scope,overlapIo);await new Promise(setImmediate);
assert.equal(startedReads,6);assert.equal(overlapCache.status(scope).syncDiagnostics.bodyReadPeak,6);
releases.shift()();await new Promise(setImmediate);assert.equal(startedReads,7);
for(const resolve of releases)resolve();await overlapPending;
const diagnostic=overlapCache.status(scope).syncDiagnostics;
assert.equal(diagnostic.bodyReadCount,7);assert.equal(diagnostic.bodyReadPeak,6);
assert.equal(diagnostic.bodyTransportCount,7);assert.equal(diagnostic.bodyConnectMs,14);assert.equal(diagnostic.bodyRequestMs,21);
assert.ok(diagnostic.bodyReadTotalMs>=diagnostic.bodyReadMaxMs);
assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE'));assert.ok(!JSON.stringify(diagnostic).includes('overlap-'));
overlapCache.close();overlapDb.close();console.log('PASS six overlapping reads, slot refill and source-free transport aggregates');

// A ledger row already identifies its shelf; body reads must stay inside that shelf.
const narrowDb=new DatabaseSync(':memory:');narrowDb.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
const narrowScope={...scope,groups:[...scope.groups,{id:'fixture-shared',personal:false}]};
const narrowCatalog=()=>reply({groups:[{group_id:'fixture-private',classification:'personal',status:'published'},{group_id:'fixture-shared',classification:'organizational',status:'published'}],coverage:{complete:true},truncated:false});
const narrowCache=new ConversationPrefetch(narrowDb);let narrowCalls=0;
await narrowCache.activate(narrowScope,{currentScope:()=>narrowScope,catalog:async()=>narrowCatalog(),call:async(tool,args)=>{
  if(tool==='get_updates')return reply({episodes:[{episode_uuid:args.group_id+'-record',group_id:args.group_id,created_at:new Date().toISOString()}],coverage:{complete:true},truncated:false});
  narrowCalls++;assert.deepEqual(args.group_ids,[args.uuid.replace(/-record$/,'')]);
  return reply({episode:{uuid:args.uuid,group_id:args.group_ids[0],content:'SYNTHETIC',origin:'manual',source_ref:'fixture',recorded_at:new Date().toISOString()},coverage:{complete:true},truncated:false});
}});
assert.equal(narrowCalls,2);assert.equal(narrowCache.snapshot(narrowScope,narrowCatalog()).records.length,2);
narrowCache.close();narrowDb.close();console.log('PASS each body lookup targets its ledger shelf, retaining full-scope permission checks');

// A turn beginning during sync lets current reads drain but stops slot refill.
const yieldingDb=new DatabaseSync(':memory:');yieldingDb.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
const yieldingCache=new ConversationPrefetch(yieldingDb);let busy=false,yieldReads=0,yieldReleases=[];
const yieldingIo={...overlapIo,isBusy:()=>busy,call:async(tool,args)=>{
  if(tool==='get_updates')return overlapIo.call(tool,args);
  yieldReads++;await new Promise(resolve=>yieldReleases.push(resolve));
  return {...reply({episode:{uuid:args.uuid,group_id:'fixture-private',content:'SYNTHETIC',origin:'manual',source_ref:'fixture',recorded_at:new Date().toISOString()},coverage:{complete:true},truncated:false})};
}};
const yieldPending=yieldingCache.activate(scope,yieldingIo);await new Promise(setImmediate);assert.equal(yieldReads,6);
busy=true;for(const resolve of yieldReleases.splice(0))resolve();await new Promise(resolve=>setTimeout(resolve,120));
assert.equal(yieldReads,6,'a busy turn prevents seventh body read');
busy=false;await new Promise(resolve=>setTimeout(resolve,120));assert.equal(yieldReads,7);
yieldReleases.shift()();await yieldPending;assert.equal(yieldingCache.status(scope).usable,true);
assert.ok(yieldingCache.status(scope).syncDiagnostics.yieldMs>=100);
// Cancellation while idle-waiting must settle promptly and erase previous data.
busy=true;const cancelPending=yieldingCache.sync(scope);await new Promise(setImmediate);
yieldingCache.invalidate(scope);await cancelPending;assert.equal(yieldingCache.status(scope).usable,false);
assert.equal(yieldReads,7);yieldingCache.close();yieldingDb.close();
console.log('PASS busy turn suspends background refill, resumes full reads and aborts idle wait');

// Freshly verified older sources survive a flood of recent incidental mentions.
const retainedDb=new DatabaseSync(':memory:');retainedDb.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
let retainedNow=current,removed=false,badRevision=false;
const older={uuid:'older-topic',group_id:'fixture-private',created_at:new Date(current-3*86400000).toISOString()};
const recent=Array.from({length:80},(_,i)=>({uuid:'recent-'+i,group_id:'fixture-private',created_at:new Date(current-i*1000).toISOString()}));
const sourceBody=row=>({uuid:row.uuid,group_id:row.group_id,created_at:row.created_at,name:row.uuid,content:'架空会社の確認済み本文。',origin:'manual',source_ref:'fixture',recorded_at:row.created_at});
const retainedIo={currentScope:()=>scope,catalog:async()=>catalog(),call:async(tool,args)=>{
 if(tool==='get_updates')return reply({episodes:(removed?recent:[...recent,older]).map(r=>({...r,episode_uuid:r.uuid})),next_cursor:'retained-fixture',coverage:{complete:true},truncated:false});
 const row=[...recent,older].find(r=>r.uuid===args.uuid);return reply({episode:{...sourceBody(row),...(badRevision&&row.uuid===older.uuid?{is_latest_revision:false}:{})},coverage:{complete:true}});
}};
const retained=new ConversationPrefetch(retainedDb,{now:()=>retainedNow,intervalMs:1});await retained.activate(scope,retainedIo);
assert.equal(retained.snapshot(scope,catalog()).records.some(r=>r.episode.uuid===older.uuid),false);
const freshResult={synapseRead:true,evidenceStatus:'supported',sources:[{uuid:older.uuid}],evidence:[{tool:'get_episode',uuid:older.uuid,result:reply({episode:sourceBody(older),coverage:{complete:true}})}]};
const checkedAt=retained.status(scope).checkedAt;
assert.equal(retained.rememberVerified(other,freshResult,catalog()),false,'No other-user snapshot or scope');
assert.equal(retained.rememberVerified(scope,{...freshResult,evidenceStatus:'insufficient'},catalog()),false);
assert.equal(retained.rememberVerified(scope,{...freshResult,evidence:[{...freshResult.evidence[0],result:reply({episode:sourceBody(older),coverage:{complete:false}})}]},catalog()),false);
const retainedEntry=retained.active.get(retained.storageKey(scope));retainedEntry.pending=Promise.resolve();
assert.equal(retained.rememberVerified(scope,freshResult,catalog()),false,'Do not overwrite an in-flight sync');retainedEntry.pending=null;
assert.equal(retained.rememberVerified(scope,freshResult,catalog()),true);
assert.equal(retained.status(scope).checkedAt,checkedAt,'Retaining a source never refreshes other bodies');
assert.equal(retained.status(scope).recordCount,64);assert.equal(retained.status(scope).bodyCoverage,'limited');
assert.deepEqual(retained.snapshot(scope,catalog()).preferredIds,[older.uuid]);
assert.equal(retained.snapshot(scope,catalog()).records[0].episode.uuid,older.uuid);
retainedNow+=2;await retained.activate(scope,retainedIo);assert.ok(retained.snapshot(scope,catalog()).records.some(r=>r.episode.uuid===older.uuid),'Next sync rereads ledger-matched preferred source');
removed=true;retained.active.get(retained.storageKey(scope)).cursors.clear();retainedNow+=2;await retained.activate(scope,retainedIo);assert.deepEqual(retained.snapshot(scope,catalog()).preferredIds,[],'A full ledger rescan without the source drops the pin');
removed=false;retained.rememberVerified(scope,freshResult,catalog());badRevision=true;retainedNow+=2;await retained.activate(scope,retainedIo);assert.equal(retained.status(scope).usable,false,'A failed preferred revision invalidates the cache');
retained.close();retainedDb.close();
console.log('PASS full verified sources retained within cap, unchanged clock, scope, refresh and deletion guards');
