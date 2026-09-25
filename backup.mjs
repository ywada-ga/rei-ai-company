import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync, chmodSync, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const allowed=['rei.sqlite','chatwork.key','connector.json','mcp-sync.json','mcp-sync.json.tmp','pending-results.json','pending-results.json.tmp'];
const dataDir=()=>process.env.REI_DATA_DIR||path.join(root,'data');
const sha256=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
function regularFile(file) {return lstatSync(file,{throwIfNoEntry:false})?.isFile()||false;}
function optionalSourceFile(file) {
  const status=lstatSync(file,{throwIfNoEntry:false});
  if(!status)return false;
  if(!status.isFile())throw new Error(`バックアップ対象が通常のファイルではありません: ${path.basename(file)}`);
  return true;
}
function checkDatabase(file) {
  const db=new DatabaseSync(file,{readOnly:true});
  try {if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('SQLiteの整合性を確認できません');}
  finally {db.close();}
}
export async function createBackup(source=dataDir(),destination=path.join(source,'backups')) {
  const database=path.join(source,'rei.sqlite');
  if(!optionalSourceFile(database))throw new Error('REIのデータベースが見つかりません');
  const present=allowed.slice(1).filter(file=>optionalSourceFile(path.join(source,file)));
  const sourceHashes=Object.fromEntries(present.map(file=>[file,sha256(path.join(source,file))]));
  const existing=lstatSync(destination,{throwIfNoEntry:false});
  if(existing&&!existing.isDirectory())throw new Error('バックアップ先には通常のフォルダを指定してください');
  mkdirSync(destination,{recursive:true,mode:0o700});
  chmodSync(destination,0o700);
  const name=`rei-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(3).toString('hex')}`;
  const folder=path.join(destination,name);
  const staging=path.join(destination,`.partial-${name}`);
  mkdirSync(staging,{mode:0o700});
  try {
    const db=new DatabaseSync(database,{readOnly:true});
    try {await backup(db,path.join(staging,'rei.sqlite'));}
    finally {db.close();}
    chmodSync(path.join(staging,'rei.sqlite'),0o600);
    for(const file of present) {
      optionalSourceFile(path.join(source,file));
      copyFileSync(path.join(source,file),path.join(staging,file),constants.COPYFILE_EXCL);
      chmodSync(path.join(staging,file),0o600);
    }
    const files=Object.fromEntries(allowed.filter(file=>regularFile(path.join(staging,file))).map(file=>[file,sha256(path.join(staging,file))]));
    const stillPresent=allowed.slice(1).filter(file=>optionalSourceFile(path.join(source,file)));
    if(JSON.stringify(stillPresent)!==JSON.stringify(present)||present.some(file=>sha256(path.join(source,file))!==sourceHashes[file]||files[file]!==sourceHashes[file]))throw new Error('バックアップ中に設定または送信待ち結果が変わりました。再試行してください');
    const manifest={format:1,createdAt:new Date().toISOString(),files};
    writeFileSync(path.join(staging,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
    verifyBackup(staging);
    renameSync(staging,folder);
  } catch(error) {rmSync(staging,{recursive:true,force:true});throw error;}
  return folder;
}
export async function createBackupIfDue(source=dataDir(),destination=path.join(source,'backups'),now=Date.now()) {
  const status=lstatSync(destination,{throwIfNoEntry:false});
  if(status&&!status.isDirectory())throw new Error('バックアップ先には通常のフォルダを指定してください');
  const latest=status?readdirSync(destination,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&entry.name.startsWith('rei-')).map(entry=>entry.name).sort().at(-1):null;
  if(latest) {
    try {
      const createdAt=Date.parse(verifyBackup(path.join(destination,latest)).createdAt);
      if(Number.isFinite(createdAt)&&createdAt<=now&&now-createdAt<86400000)return null;
    } catch { /* A damaged latest backup must not suppress a fresh backup. */ }
  }
  return createBackup(source,destination);
}
export function verifyBackup(folder) {
  const manifestFile=path.join(folder,'manifest.json');
  if(!regularFile(manifestFile)||lstatSync(manifestFile).size>10000)throw new Error('バックアップの目録が不正です');
  let manifest;
  try {manifest=JSON.parse(readFileSync(manifestFile,'utf8'));}catch{throw new Error('バックアップの目録を読めません');}
  if(manifest.format!==1||!manifest.files||typeof manifest.files!=='object'||!manifest.files['rei.sqlite'])throw new Error('バックアップ形式が正しくありません');
  for(const [name,digest] of Object.entries(manifest.files)) {
    if(!allowed.includes(name)||!regularFile(path.join(folder,name))||!(/^[a-f0-9]{64}$/.test(digest))||sha256(path.join(folder,name))!==digest)throw new Error(`バックアップの検証に失敗しました: ${name}`);
  }
  checkDatabase(path.join(folder,'rei.sqlite'));
  return {createdAt:manifest.createdAt,files:Object.keys(manifest.files)};
}
export function restoreBackup(folder,destination) {
  if(!destination)throw new Error('復元先には新しい空のフォルダを指定してください');
  const existing=lstatSync(destination,{throwIfNoEntry:false});
  if(existing&&(!existing.isDirectory()||readdirSync(destination).length))throw new Error('復元先には新しい空のフォルダを指定してください');
  const verified=verifyBackup(folder);
  mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
  const staging=path.join(path.dirname(destination),`.partial-restore-${randomBytes(8).toString('hex')}`);
  mkdirSync(staging,{mode:0o700});
  try {
    for(const file of verified.files) {copyFileSync(path.join(folder,file),path.join(staging,file),constants.COPYFILE_EXCL);chmodSync(path.join(staging,file),0o600);}
    copyFileSync(path.join(folder,'manifest.json'),path.join(staging,'manifest.json'),constants.COPYFILE_EXCL);
    chmodSync(path.join(staging,'manifest.json'),0o600);
    verifyBackup(staging);
    if(existing)rmdirSync(destination);
    renameSync(staging,destination);
  } catch(error) {rmSync(staging,{recursive:true,force:true});throw error;}
  return destination;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const action=process.argv[2];
    if(action==='create')console.log(await createBackup(dataDir(),process.argv[3]||path.join(dataDir(),'backups')));
    else if(action==='verify')console.log(JSON.stringify(verifyBackup(process.argv[3])));
    else if(action==='restore')console.log(restoreBackup(process.argv[3],process.argv[4]));
    else throw new Error('使い方: node backup.mjs create [保存先] | verify <バックアップ> | restore <バックアップ> <新しい復元先>');
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
