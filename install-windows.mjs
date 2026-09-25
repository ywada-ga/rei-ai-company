import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobTimeoutSeconds } from './openclaw-process.mjs';

if(process.platform!=='win32')throw new Error('このインストーラーはWindows用です');
const mode=process.argv[2];
if(!['hub','connector'].includes(mode))throw new Error('使い方: node install-windows.mjs hub | connector');
if(mode==='connector')jobTimeoutSeconds();
const appData=process.env.APPDATA;
if(!appData)throw new Error('WindowsのAPPDATAが見つかりません');
const root=path.dirname(fileURLToPath(import.meta.url));
const entry=path.join(root,mode==='hub'?'hub.mjs':'connector.mjs');
const startup=process.env.REI_STARTUP_DIR||path.join(appData,'Microsoft','Windows','Start Menu','Programs','Startup');
const safe=value=>{if(/["%\r\n]/.test(value))throw new Error('インストール先のパスに使用できない文字が含まれます');return `"${value}"`;};
const environment=['REI_DATA_DIR','REI_CONNECTOR_CONFIG','REI_PORT','REI_JOB_TIMEOUT_SECONDS'].filter(key=>process.env[key]).map(key=>`set ${safe(`${key}=${process.env[key]}`)}\r\n`).join('');
mkdirSync(startup,{recursive:true});
const file=path.join(startup,mode==='hub'?'REI Hub.cmd':'REI Connector.cmd');
const previous=existsSync(file)?readFileSync(file):null;
const temporary=`${file}.${process.pid}.tmp`;
const replace=content=>{
  try {writeFileSync(temporary,content,{flag:'wx'});renameSync(temporary,file);}
  catch(error) {if(existsSync(temporary))unlinkSync(temporary);throw error;}
};
replace(`@echo off\r\nsetlocal DisableDelayedExpansion\r\ncd /d ${safe(root)}\r\n${environment}start "" /min ${safe(process.execPath)} ${safe(entry)}\r\n`);
if(process.env.REI_NO_START!=='1') {
  try {
    const child=spawn(process.execPath,[entry],{cwd:root,detached:true,stdio:'ignore',windowsHide:true});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();
  } catch(error) {
    try {if(previous)replace(previous);else unlinkSync(file);}
    catch(restoreError) {throw new Error(`自動起動の復旧に失敗しました: ${restoreError.message}。元のエラー: ${error.message}`);}
    throw new Error(`起動できず自動起動の設定を元に戻しました: ${error.message}`);
  }
}
console.log(process.env.REI_NO_START==='1'?`REI ${mode} をWindowsログイン時の自動起動に登録しました。`:`REI ${mode} を今すぐ起動し、Windowsログイン時の自動起動に登録しました。`);
