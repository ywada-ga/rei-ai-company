import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';

const root=path.dirname(fileURLToPath(import.meta.url));
const data=path.join(root,'data');
const agents=path.join(os.homedir(),'Library','LaunchAgents');
const escapeXml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const string=value=>`<string>${escapeXml(value)}</string>`;
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
<key>EnvironmentVariables</key><dict><key>PATH</key>${string(process.env.PATH||'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')}</dict>
</dict></plist>`;
  writeFileSync(file,plist,{mode:0o600});chmodSync(file,0o600);
  const target=`gui/${process.getuid()}/${label}`;
  spawnSync('launchctl',['bootout',target],{stdio:'ignore'});
  let result;
  for(let attempt=0;attempt<5;attempt++) {
    if(attempt)await new Promise(resolve=>setTimeout(resolve,300));
    result=spawnSync('launchctl',['bootstrap',`gui/${process.getuid()}`,file],{encoding:'utf8'});
    if(result.status===0)break;
  }
  if(result.status!==0)throw new Error(`launchctl: ${result.stderr||result.stdout}`);
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
