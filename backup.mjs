import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const allowed=['rei.sqlite','chatwork.key','connector.json','mcp-sync.json','pending-results.json','pending-results.json.tmp'];
const dataDir=()=>process.env.REI_DATA_DIR||path.join(root,'data');
const sha256=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
function regularFile(file) {return existsSync(file)&&lstatSync(file).isFile();}
function checkDatabase(file) {
  const db=new DatabaseSync(file,{readOnly:true});
  try {if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('SQLiteの整合性を確認できません');}
  finally {db.close();}
}
export async function createBackup(source=dataDir(),destination=path.join(source,'backups')) {
  const database=path.join(source,'rei.sqlite');
  if(!regularFile(database))throw new Error('REIのデータベースが見つかりません');
  mkdirSync(destination,{recursive:true,mode:0o700});
  chmodSync(destination,0o700);
  const name=`rei-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(3).toString('hex')}`;
  const folder=path.join(destination,name);
  mkdirSync(folder,{mode:0o700});
  const db=new DatabaseSync(database,{readOnly:true});
  try {await backup(db,path.join(folder,'rei.sqlite'));}
  finally {db.close();}
  chmodSync(path.join(folder,'rei.sqlite'),0o600);
  for(const file of allowed.slice(1))if(regularFile(path.join(source,file))) {copyFileSync(path.join(source,file),path.join(folder,file),constants.COPYFILE_EXCL);chmodSync(path.join(folder,file),0o600);}
  const files=Object.fromEntries(allowed.filter(file=>regularFile(path.join(folder,file))).map(file=>[file,sha256(path.join(folder,file))]));
  const manifest={format:1,createdAt:new Date().toISOString(),files};
  writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
  verifyBackup(folder);
  return folder;
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
  if(!destination||existsSync(destination)&&readdirSync(destination).length)throw new Error('復元先には新しい空のフォルダを指定してください');
  const verified=verifyBackup(folder);
  mkdirSync(destination,{recursive:true,mode:0o700});
  chmodSync(destination,0o700);
  for(const file of verified.files) {copyFileSync(path.join(folder,file),path.join(destination,file),constants.COPYFILE_EXCL);chmodSync(path.join(destination,file),0o600);}
  checkDatabase(path.join(destination,'rei.sqlite'));
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
