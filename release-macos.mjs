import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if(process.platform!=='darwin')throw new Error('Mac用の配布処理はMacで実行してください');
const root=path.dirname(fileURLToPath(import.meta.url));
const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
const source=path.join(root,'dist',`REI-${version}-${process.arch}.app`);
const identity=process.env.REI_DEVELOPER_IDENTITY?.trim();
const profile=process.env.REI_NOTARY_PROFILE?.trim();
if(!identity?.startsWith('Developer ID Application: ')||!profile)
  throw new Error('配布にはDeveloper ID Applicationの署名IDと、公証用Keychainプロファイルが必要です。REI_DEVELOPER_IDENTITY と REI_NOTARY_PROFILE を設定してください');
if(!existsSync(source)||!lstatSync(source).isDirectory())throw new Error(`開発用アプリがありません: ${source}`);
const release=path.join(root,'dist',`REI-${version}-${process.arch}-notarized.zip`);
if(existsSync(release))throw new Error(`既存の配布ファイルは上書きしません: ${release}`);

function run(command,args) {
  const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:4*1024*1024});
  if(result.error||result.status!==0)throw new Error(`${command} ${args[0]}: ${result.error?.message||result.stderr||result.stdout}`);
  return result.stdout;
}
function* files(dir) {
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const target=path.join(dir,entry.name);
    if(entry.isDirectory())yield* files(target);
    else if(entry.isFile())yield target;
  }
}
function machO(file) {
  const name=path.basename(file);
  if(!['.node','.dylib','.so'].includes(path.extname(name))&&!(statSync(file).mode&0o111))return false;
  return run('/usr/bin/file',['-b',file]).includes('Mach-O');
}

const work=mkdtempSync(path.join(os.tmpdir(),'rei-release-'));
const app=path.join(work,path.basename(source));
const submission=path.join(work,'submission.zip');
try {
  run('/usr/bin/ditto',[source,app]);
  const entitlements=path.join(root,'macos-release-entitlements.plist');
  let signed=0;
  for(const file of files(path.join(app,'Contents'))) {
    if(!machO(file))continue;
    const args=['--force','--options','runtime','--timestamp','--sign',identity];
    if(file===path.join(app,'Contents','MacOS','node'))args.push('--entitlements',entitlements);
    args.push(file);
    run('/usr/bin/codesign',args);
    signed++;
  }
  if(!signed)throw new Error('署名するMac用実行ファイルが見つかりません');
  run('/usr/bin/codesign',['--force','--options','runtime','--timestamp','--sign',identity,app]);
  run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',app]);
  run('/usr/bin/ditto',['-c','-k','--keepParent',app,submission]);
  const result=JSON.parse(run('/usr/bin/xcrun',['notarytool','submit',submission,'--keychain-profile',profile,'--wait','--output-format','json']));
  if(result.status!=='Accepted')throw new Error(`Appleの公証が完了しませんでした: ${result.status||'不明'} (${result.id||'IDなし'})`);
  run('/usr/bin/xcrun',['stapler','staple',app]);
  run('/usr/bin/xcrun',['stapler','validate',app]);
  run('/usr/sbin/spctl',['--assess','--type','execute','--verbose=4',app]);
  run('/usr/bin/ditto',['-c','-k','--keepParent',app,release]);
  console.log(`署名・公証済みの配布ZIPを作成しました: ${release}`);
} finally {
  rmSync(work,{recursive:true,force:true});
}
