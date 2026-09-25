import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if(process.platform!=='linux')throw new Error('このインストーラーはLinux用です');
const mode=process.argv[2];
if(!['hub','connector'].includes(mode))throw new Error('使い方: node install-linux.mjs hub | connector');
const root=path.dirname(fileURLToPath(import.meta.url));
const units=process.env.REI_SYSTEMD_DIR||path.join(os.homedir(),'.config','systemd','user');
const name=mode==='hub'?'rei-hub.service':'rei-connector.service';
const entry=path.join(root,mode==='hub'?'hub.mjs':'connector.mjs');
const quote=value=>{if(/["%\\\r\n]/.test(value))throw new Error('インストール先のパスに使用できない文字が含まれます');return `"${value}"`;};
mkdirSync(units,{recursive:true,mode:0o700});
const file=path.join(units,name);
const unit=`[Unit]
Description=REI ${mode==='hub'?'Hub':'Connector'}
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${quote(root)}
ExecStart=${quote(process.execPath)} ${quote(entry)}
Environment=${quote(`PATH=${process.env.PATH||'/usr/local/bin:/usr/bin:/bin'}`)}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
writeFileSync(file,unit,{mode:0o600});chmodSync(file,0o600);
if(process.env.REI_NO_START!=='1') {
  for(const args of [['--user','daemon-reload'],['--user','enable','--now',name]]) {
    const result=spawnSync('systemctl',args,{encoding:'utf8'});
    if(result.status!==0)throw new Error(`自動起動を有効にできません: ${result.error?.message||result.stderr||result.stdout||'systemctlが利用できません'}`);
  }
}
console.log(`REI ${mode} の自動起動設定: ${file}`);
