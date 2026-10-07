import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localizeLinks } from './package-links.mjs';

if(process.platform!=='darwin')throw new Error('macOS用アプリはMac上で作成してください');
const root=path.dirname(fileURLToPath(import.meta.url));
const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
const arch=process.arch;
if(!['arm64','x64'].includes(arch))throw new Error(`未対応のMac CPU: ${arch}`);
const nodeVersion='24.21.0';
const archiveName=`node-v${nodeVersion}-darwin-${arch}.tar.gz`;
const release=`https://nodejs.org/download/release/v${nodeVersion}`;
const dist=path.join(root,'dist');
const app=path.join(dist,`REI-${version}-${arch}.app`);
const work=path.join(dist,`.rei-${version}-${arch}-${process.pid}`);
const contents=path.join(work,'Contents');
const bin=path.join(contents,'MacOS');
const resources=path.join(contents,'Resources');

function run(command,args) {
  const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:1024*1024});
  if(result.error||result.status!==0)throw new Error(`${command}: ${result.error?.message||result.stderr||result.stdout}`);
}
function xml(value) {return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
async function download(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error(`取得に失敗しました: ${url} (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}
function openClawRoot() {
  const override=process.env.REI_OPENCLAW_SOURCE;
  const entry=override?path.join(path.resolve(override),'openclaw.mjs'):
    realpathSync(spawnSync('which',['openclaw'],{encoding:'utf8'}).stdout.trim());
  const source=path.dirname(entry);
  const meta=JSON.parse(readFileSync(path.join(source,'package.json'),'utf8'));
  if(meta.name!=='openclaw'||!existsSync(path.join(source,'LICENSE'))||!existsSync(path.join(source,'THIRD_PARTY_NOTICES.md')))
    throw new Error('OpenClawの配布元とライセンス表示を確認できません');
  return {source,version:meta.version};
}

if(existsSync(app))throw new Error(`既存のアプリを上書きしません: ${app}`);
const openClaw=openClawRoot();
mkdirSync(dist,{recursive:true});
mkdirSync(bin,{recursive:true});
mkdirSync(resources,{recursive:true});
try {
  console.log(`公式Node.js ${nodeVersion} (${arch}) を取得して検証しています…`);
  const [archive,shasums]=await Promise.all([download(`${release}/${archiveName}`),download(`${release}/SHASUMS256.txt`)]);
  const hash=shasums.toString('utf8').split('\n').find(line=>line.endsWith(`  ${archiveName}`))?.split(/\s+/)[0];
  if(!hash||createHash('sha256').update(archive).digest('hex')!==hash)throw new Error('Node.jsのSHA-256が公式一覧と一致しません');
  const archivePath=path.join(work,archiveName);
  writeFileSync(archivePath,archive);
  run('tar',['-xzf',archivePath,'-C',work,`node-v${nodeVersion}-darwin-${arch}/bin/node`,`node-v${nodeVersion}-darwin-${arch}/LICENSE`]);
  const extracted=path.join(work,`node-v${nodeVersion}-darwin-${arch}`);
  copyFileSync(path.join(extracted,'bin','node'),path.join(bin,'node'));
  chmodSync(path.join(bin,'node'),0o755);
  mkdirSync(path.join(resources,'licenses'),{recursive:true});
  copyFileSync(path.join(extracted,'LICENSE'),path.join(resources,'licenses','NODE_LICENSE'));

  const source=path.join(resources,'rei');
  mkdirSync(source);
  for(const name of readdirSync(root))if(name.endsWith('.mjs')&&!['package-macos.mjs','package-links.mjs','release-macos.mjs'].includes(name))copyFileSync(path.join(root,name),path.join(source,name));
  for(const name of ['package.json','LICENSE','README.md'])copyFileSync(path.join(root,name),path.join(source,name));
  copyFileSync(path.join(root,'local-tts-worker.py'),path.join(source,'local-tts-worker.py'));
  cpSync(path.join(root,'public'),path.join(source,'public'),{recursive:true});

  console.log(`OpenClaw ${openClaw.version} をアプリ内に同梱しています…`);
  const bundledOpenClaw=path.join(resources,'openclaw');
  cpSync(openClaw.source,bundledOpenClaw,{recursive:true});
  localizeLinks(openClaw.source,bundledOpenClaw);
  const launcher=`#!/bin/zsh\nset -eu\napp_root="\${0:A:h:h}"\nexport PATH="$app_root/MacOS:/usr/bin:/bin:/usr/sbin:/sbin"\nexport REI_DATA_DIR="\${REI_DATA_DIR:-$HOME/Library/Application Support/REI}"\nexport REI_OPENCLAW_ENTRY="$app_root/Resources/openclaw/openclaw.mjs"\nexec "$app_root/MacOS/node" "$app_root/Resources/rei/macos-onboarding.mjs"\n`;
  writeFileSync(path.join(bin,'REI'),launcher,{mode:0o755});
  writeFileSync(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>CFBundleIdentifier</key><string>com.rei.local</string>\n<key>CFBundleName</key><string>REI</string>\n<key>CFBundleDisplayName</key><string>REI</string>\n<key>CFBundleExecutable</key><string>REI</string>\n<key>CFBundlePackageType</key><string>APPL</string>\n<key>CFBundleShortVersionString</key><string>${xml(version)}</string>\n<key>CFBundleVersion</key><string>${xml(version)}</string>\n<key>LSMinimumSystemVersion</key><string>13.5</string>\n</dict></plist>\n`);
  rmSync(archivePath);
  rmSync(extracted,{recursive:true,force:true});
  renameSync(work,app);
  console.log(`作成しました: ${app}`);
  console.log('このビルドは開発用です。配布前に署名・公証と新規Macでの実機確認が必要です。');
} catch(error) {
  rmSync(work,{recursive:true,force:true});
  throw error;
}
