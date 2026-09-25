import { DatabaseSync } from 'node:sqlite';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDirectory, verifyBackup } from './backup.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const data=process.env.REI_DATA_DIR||path.join(root,'data');
const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
const port=Number(process.env.REI_PORT||4178);
let problems=0;
const result=(ok,message)=>{console.log(`${ok?'OK':'要確認'}  ${message}`);if(!ok)problems++;};

result(Number(process.versions.node.split('.')[0])>=24,`Node.js ${process.versions.node}（24以降が必要）`);
let ownerCount=null;
try {
  const file=path.join(data,'rei.sqlite');
  if(!lstatSync(file,{throwIfNoEntry:false})?.isFile())throw new Error('not a regular file');
  const db=new DatabaseSync(file,{readOnly:true});
  try {
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('integrity check failed');
    ownerCount=db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='owner'").get().count;
    result(true,'REIのデータベースは正常です');
    result(ownerCount===1,ownerCount===0?'所有者の初回登録を完了してください':ownerCount===1?'所有者を確認しました':'所有者の登録状態を確認してください');
    const running=db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status IN ('running','sending')").get().count;
    if(running)console.log(`情報  実行中の工程 ${running}件。更新・再起動の前に完了を確認してください`);
  } finally {db.close();}
} catch {result(false,'REIのデータベースを確認できません。初回起動または保存先を確認してください');}

try {
  const response=await fetch(`http://127.0.0.1:${port}/api?route=setup%2Fstatus`,{signal:AbortSignal.timeout(5000)});
  const status=response.ok?await response.json():null;
  const ready=response.ok&&typeof status?.needsSetup==='boolean'&&(ownerCount===null||status.needsSetup===(ownerCount===0));
  result(ready,ready?'REI本体は正常に応答しています':response.ok?'REI本体の登録状態を確認してください':'REI本体が起動していません');
  if(ready)result(status.version===version,status.version===version?`起動中のREIは最新版 ${version} です`:'起動中のREIがこのフォルダの版と異なります。仕事が終わってからREI本体を再起動してください');
} catch {result(false,'REI本体に接続できません。自動起動または保存先を確認してください');}

if(ownerCount===1) {
  let folder;
  try {
    folder=backupDirectory(data);
    const latest=readdirSync(folder,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&entry.name.startsWith('rei-')).map(entry=>entry.name).sort().at(-1);
    if(!latest)throw new Error('no backup');
    const verified=verifyBackup(path.join(folder,latest));
    const createdAt=Date.parse(verified.createdAt);
    if(!Number.isFinite(createdAt)||createdAt>Date.now()+300000)throw new Error('invalid backup time');
    const ageDays=Math.floor((Date.now()-createdAt)/86400000);
    result(ageDays<7,ageDays<7?'最新のバックアップを検証しました':`最新のバックアップは${ageDays}日前です。新しいバックアップを作成してください`);
  } catch(error) {result(false,String(error.message||'').startsWith('REI_BACKUP_DIR')?error.message:'有効なバックアップを確認できません。REI画面でバックアップを作成してください');}
  if(folder&&lstatSync(folder,{throwIfNoEntry:false})?.isDirectory()) {
    const stale=readdirSync(folder,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&entry.name.startsWith('.partial-')).filter(entry=>Date.now()-lstatSync(path.join(folder,entry.name)).mtimeMs>3600000);
    if(stale.length)result(false,`中断したバックアップが${stale.length}件残っています。内容を確認するまで削除しないでください`);
  }
}
console.log(problems?`中心PCの診断完了: ${problems}件を確認してください`:`中心PCの診断完了: 正常です（REI ${version}）`);
if(problems)process.exitCode=1;
