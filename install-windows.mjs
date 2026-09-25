import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if(process.platform!=='win32')throw new Error('このインストーラーはWindows用です');
const mode=process.argv[2];
if(!['hub','connector'].includes(mode))throw new Error('使い方: node install-windows.mjs hub | connector');
const appData=process.env.APPDATA;
if(!appData)throw new Error('WindowsのAPPDATAが見つかりません');
const root=path.dirname(fileURLToPath(import.meta.url));
const entry=path.join(root,mode==='hub'?'hub.mjs':'connector.mjs');
const startup=process.env.REI_STARTUP_DIR||path.join(appData,'Microsoft','Windows','Start Menu','Programs','Startup');
const safe=value=>{if(/["%\r\n]/.test(value))throw new Error('インストール先のパスに使用できない文字が含まれます');return `"${value}"`;};
mkdirSync(startup,{recursive:true});
const file=path.join(startup,mode==='hub'?'REI Hub.cmd':'REI Connector.cmd');
writeFileSync(file,`@echo off\r\ncd /d ${safe(root)}\r\nstart "" /min ${safe(process.execPath)} ${safe(entry)}\r\n`);
if(process.env.REI_NO_START!=='1') {
  const child=spawn(process.execPath,[entry],{cwd:root,detached:true,stdio:'ignore',windowsHide:true});
  child.unref();
}
console.log(`REI ${mode} を今すぐ起動し、Windowsログイン時の自動起動に登録しました。`);
