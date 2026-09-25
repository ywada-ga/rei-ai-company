import { mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';

const root=path.dirname(fileURLToPath(import.meta.url));
const data=process.env.REI_DATA_DIR||path.join(root,'data');
const agents=process.env.REI_LAUNCH_AGENTS_DIR||path.join(os.homedir(),'Library','LaunchAgents');
const escapeXml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const string=value=>`<string>${escapeXml(value)}</string>`;
const environment=Object.fromEntries(['PATH','REI_DATA_DIR','REI_CONNECTOR_CONFIG','REI_PORT','REI_JOB_TIMEOUT_SECONDS'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
async function install(label,program,args,log) {
  mkdirSync(agents,{recursive:true});mkdirSync(data,{recursive:true,mode:0o700});
  const file=path.join(agents,`${label}.plist`);
  const plist=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${string(label)}
<key>ProgramArguments</key><array>${[program,...args].map(string).join('')}</array>
<key>WorkingDirectory</key>${string(root)}
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key>${string(log)}<key>StandardErrorPath</key>${string(log)}
<key>EnvironmentVariables</key><dict>${Object.entries({PATH:'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',...environment}).map(([key,value])=>`<key>${key}</key>${string(value)}`).join('')}</dict>
</dict></plist>`;
  const previous=existsSync(file)?readFileSync(file):null;
  const temporary=`${file}.${process.pid}.tmp`;
  writeFileSync(temporary,plist,{mode:0o600,flag:'wx'});
  renameSync(temporary,file);chmodSync(file,0o600);
  const target=`gui/${process.getuid()}/${label}`;
  spawnSync('launchctl',['bootout',target],{stdio:'ignore'});
  let result;
  for(let attempt=0;attempt<5;attempt++) {
    if(attempt)await new Promise(resolve=>setTimeout(resolve,300));
    result=spawnSync('launchctl',['bootstrap',`gui/${process.getuid()}`,file],{encoding:'utf8'});
    if(result.status===0)break;
  }
  if(result.status!==0) {
    if(previous) {
      writeFileSync(temporary,previous,{mode:0o600,flag:'wx'});
      renameSync(temporary,file);chmodSync(file,0o600);
      const restored=spawnSync('launchctl',['bootstrap',`gui/${process.getuid()}`,file],{encoding:'utf8'});
      if(restored.status!==0)throw new Error(`launchctl: 新しい設定も元の設定も起動できません。${restored.stderr||restored.stdout}`);
    } else unlinkSync(file);
    throw new Error(`launchctl: 新しい設定を起動できませんでした。${previous?'元の設定へ戻しました。':'自動起動の登録を取り消しました。'}${result.stderr||result.stdout}`);
  }
  console.log(`${label} を自動起動に登録しました。ログ: ${log}`);
}
const rl=createInterface({input:process.stdin,output:process.stdout});
try {
  const mode=process.argv[2];
  if(mode==='hub') await install('ai.rei.hub',process.execPath,['hub.mjs'],path.join(data,'hub.log'));
  else if(mode==='connector') await install('ai.rei.connector',process.execPath,['connector.mjs'],path.join(data,'connector.log'));
  else if(mode==='tunnel') {
    const target=(await rl.question('中心PCのSSH接続先（例: user@192.168.1.10 またはTailscale名）: ')).trim();
    if(!/^[A-Za-z0-9_.@:-]+$/.test(target))throw new Error('SSH接続先の形式が正しくありません');
    await install('ai.rei.tunnel','/usr/bin/ssh',['-N','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','BatchMode=yes','-L','127.0.0.1:4179:127.0.0.1:4178',target],path.join(data,'tunnel.log'));
  } else throw new Error('使い方: node install-macos.mjs hub | connector | tunnel');
} finally {rl.close();}
