import { mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
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
const environment=['REI_DATA_DIR','REI_CONNECTOR_CONFIG','REI_PORT'].filter(key=>process.env[key]).map(key=>`Environment=${quote(`${key}=${process.env[key]}`)}`).join('\n');
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
${environment}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
const previous=existsSync(file)?readFileSync(file):null;
const temporary=`${file}.${process.pid}.tmp`;
writeFileSync(temporary,unit,{mode:0o600,flag:'wx'});
renameSync(temporary,file);chmodSync(file,0o600);
const systemctl=args=>{
  const result=spawnSync('systemctl',['--user',...args],{encoding:'utf8'});
  if(result.status!==0)throw new Error(result.error?.message||result.stderr||result.stdout||'systemctlが利用できません');
};
if(process.env.REI_NO_START!=='1') {
  try {
    systemctl(['daemon-reload']);
    systemctl(['enable','--now',name]);
    if(previous)systemctl(['restart',name]);
  } catch(error) {
    if(previous) {
      writeFileSync(temporary,previous,{mode:0o600,flag:'wx'});
      renameSync(temporary,file);chmodSync(file,0o600);
    } else unlinkSync(file);
    try {
      systemctl(['daemon-reload']);
      if(previous)systemctl(['restart',name]);
      else systemctl(['disable','--now',name]);
    } catch(restoreError) {throw new Error(`自動起動の復旧に失敗しました: ${restoreError.message}。元のエラー: ${error.message}`);}
    throw new Error(`自動起動を有効にできず元の設定に戻しました: ${error.message}`);
  }
}
console.log(`REI ${mode} の自動起動設定: ${file}`);
