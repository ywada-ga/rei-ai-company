// REI's executable adaptation of sc-skills:load-synapse 0.8.0.
// Restrict all reads to the user's existing selected groups; no writes or access changes.
export const loadSynapseSkill={name:'load-synapse',version:'0.8.0',instructions:'会社の話題は選択グループのsurvey_spaceで全体像を確認してから、実体名・固有名詞ごとにsearch_memory_factsを1〜2回行う。原文候補のsearch_episodesは一致の証拠ではない。full_content_lookupが指定したget_episodeで本文を確認する。coverageを読み、no_matchとgroup_unavailableを区別し、後者は再試行しない。新旧の記録が矛盾するときは両方の日時を示し、古い情報で現在を断定しない。出どころ・確認範囲・未確認部分を回答に残す。URLは取得応答に含まれるものだけを使い、作らない。'};
export function mcpData(result){
 if(result?.structuredContent)return result.structuredContent;
 for(const item of result?.content||[])if(item.type==='text')try{return JSON.parse(item.text);}catch{}
 return null;
}
export function unavailableGroups(result,groups){
 const ids=new Set(),selected=new Set(groups.map(g=>g.id));let global=false;
 const visit=value=>{
  if(value==='group_unavailable'){global=true;return;}
  if(Array.isArray(value)){value.forEach(visit);return;}
  if(!value||typeof value!=='object')return;
  if(['status','reason','outcome','code'].some(key=>value[key]==='group_unavailable')){
   const id=value.group_id||value.id;if(selected.has(id))ids.add(id);else if(!id)global=true;
  }
  for(const valueOf of Object.values(value))if(valueOf&&typeof valueOf==='object')visit(valueOf);
 };
 visit(mcpData(result));return ids.size?[...ids]:global?groups.map(g=>g.id):[];
}
export function needsRecentEvidence(question,context=[]){
 const recent=/(今|現在|最新|直近|昨日|今日|一昨日|先週|今週|今月|\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2})/u;
 return recent.test(question)||(/(それ|その|シナプス|Synapse|記録|データ)/iu.test(question)&&recent.test(context.at(-1)?.question||''));
}
export function episodeLookups(result,groups,{recent=false}={}){
 const data=mcpData(result),rows=data?.episodes||data?.results||data?.items||[];
 if(!Array.isArray(rows))return [];
 const found=new Map();
 const candidates=recent?[...rows].sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)):rows;
 for(const row of candidates){
  const lookup=row?.full_content_lookup,args=lookup?.arguments||lookup?.args;
  // Full candidates still need a scoped provenance lookup before becoming evidence.
  const full=!lookup&&row.content_representation==='full'&&!row.content_truncated&&typeof row.uuid==='string';
  const readArgs=full?{uuid:row.uuid,group_id:row.group_id}:args;
  if((!full&&lookup?.tool!=='get_episode')||!readArgs||typeof readArgs.uuid!=='string'||!groups.some(g=>g.id===(readArgs.group_id||row.group_id)))continue;
  // Only the declared read arguments survive; never forward arbitrary candidate fields.
  found.set(readArgs.uuid,{uuid:readArgs.uuid,...(readArgs.group_id?{group_id:readArgs.group_id}:{}),group_ids:groups.map(g=>g.id)});
 }
 return [...found.values()].slice(0,2);
}
