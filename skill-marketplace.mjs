import { spawn } from 'node:child_process';

export function normalizeSkillResults(payload) {
  if(!Array.isArray(payload?.results))throw new Error('スキル検索の応答を読み取れません');
  return payload.results.slice(0,12).map(item=>({
    name:String(item.displayName||item.slug||'').slice(0,120),
    owner:String(item.ownerHandle||item.publisher?.handle||'').slice(0,80),
    summary:String(item.summary||'').slice(0,500),
    reference:String(item.install?.reference||'').slice(0,180),
    official:item.official===true,
    installability:String(item.trust?.installability||'unknown'),
    url:typeof item.canonicalUrl==='string'&&/^\/[a-z0-9_-]+\/skills\/[a-z0-9_-]+$/i.test(item.canonicalUrl)?`https://clawhub.ai${item.canonicalUrl}`:null
  })).filter(item=>item.name&&item.reference);
}

export async function searchMarketplaceSkills(query,{entry=process.env.REI_OPENCLAW_ENTRY||'openclaw',node=process.execPath}={}) {
  if(typeof query!=='string'||!query.trim()||query.length>100)throw new Error('検索語を1〜100文字で入力してください');
  const args=['skills','search',query.trim(),'--json','--limit','12'];
  const command=entry==='openclaw'?'openclaw':node;
  if(entry!=='openclaw')args.unshift(entry);
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],env:process.env});
    let output='',detail='',finished=false;
    const timer=setTimeout(()=>child.kill('SIGTERM'),20000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2_000_000)child.kill('SIGTERM');});
    child.stderr.on('data',chunk=>{detail+=chunk;if(detail.length>2000)detail=detail.slice(-2000);});
    child.once('error',error=>{if(!finished){finished=true;clearTimeout(timer);reject(error);}});
    child.once('close',code=>{if(finished)return;finished=true;clearTimeout(timer);if(code!==0)return reject(new Error(detail.trim()||'スキル検索に失敗しました'));try{resolve(normalizeSkillResults(JSON.parse(output)));}catch(error){reject(error);}});
  });
}
