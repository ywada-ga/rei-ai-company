import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if(process.platform!=='darwin')throw new Error('Mac用の起動画面です');
const root=path.dirname(fileURLToPath(import.meta.url));
const data=process.env.REI_DATA_DIR||path.join(root,'data');
const modeFile=path.join(data,'app-mode');

function dialog(script) {
  const result=spawnSync('/usr/bin/osascript',['-e',script],{encoding:'utf8',timeout:120000});
  if(result.status!==0) {
    if(/User canceled|ユーザがキャンセル|(-128)/i.test(result.stderr||''))return null;
    throw new Error((result.stderr||'画面を開けませんでした').trim());
  }
  return result.stdout.trim();
}
function notice(message) {
  if(process.env.REI_NO_DIALOG==='1'){console.log(message);return;}
  const safe=String(message).slice(0,1200).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\n','\\n');
  dialog(`display dialog "${safe}" with title "REI" buttons {"OK"} default button "OK"`);
}
function serviceNeedsRepair(label,script) {
  const agents=process.env.REI_LAUNCH_AGENTS_DIR||path.join(os.homedir(),'Library','LaunchAgents');
  const service=path.join(agents,`${label}.plist`);
  if(!existsSync(service))return true;
  const program=spawnSync('/usr/bin/plutil',['-extract','ProgramArguments.0','raw','-o','-',service],{encoding:'utf8'});
  const argument=spawnSync('/usr/bin/plutil',['-extract','ProgramArguments.1','raw','-o','-',service],{encoding:'utf8'});
  const workingDirectory=spawnSync('/usr/bin/plutil',['-extract','WorkingDirectory','raw','-o','-',service],{encoding:'utf8'});
  const loaded=spawnSync('launchctl',['print',`gui/${process.getuid()}/${label}`],{encoding:'utf8'});
  return program.status!==0||argument.status!==0||workingDirectory.status!==0||program.stdout.trim()!==process.execPath||argument.stdout.trim()!==script||workingDirectory.stdout.trim()!==root||loaded.status!==0;
}
function repairService(mode) {
  const installed=spawnSync(process.execPath,[path.join(root,'install-macos.mjs'),mode],{cwd:root,env:process.env,encoding:'utf8',timeout:30000});
  if(installed.status!==0)throw new Error(`${mode==='hub'?'中心PC':'参加PC'}の自動起動を登録できませんでした: ${(installed.stderr||installed.stdout||installed.error?.message||'原因不明').trim()}`);
}
function saveMode(mode) {
  mkdirSync(data,{recursive:true,mode:0o700});
  if(existsSync(modeFile))throw new Error('既存のREI起動設定があります。上書きせず確認してください');
  writeFileSync(modeFile,`${mode}\n`,{mode:0o600,flag:'wx'});
}
async function host() {
  if(serviceNeedsRepair('ai.rei.hub','hub.mjs')) {
    repairService('hub');
    const port=Number(process.env.REI_PORT||4178);
    let ready=false;
    for(let attempt=0;attempt<30;attempt++) {
      try {
        const response=await fetch(`http://127.0.0.1:${port}/api?route=setup%2Fstatus`,{signal:AbortSignal.timeout(1000)});
        if(response.ok){ready=true;break;}
      } catch { /* launchd may still be starting the Hub */ }
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!ready)throw new Error('自動起動を登録しましたが、中心PCのREIが応答しません。REIのログを確認してください');
  }
  const child=spawn(process.execPath,[path.join(root,'launch.mjs')],{cwd:root,env:process.env,stdio:'inherit'});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`REIの起動が終了しました (${code})`)));});
}
async function main() {
  if(existsSync(modeFile)&&!lstatSync(modeFile).isFile())throw new Error('REIの起動設定が通常のファイルではありません');
  let mode=existsSync(modeFile)?readFileSync(modeFile,'utf8').trim():'';
  if(!mode) {
    const selection=dialog('button returned of (display dialog "このMacでREIをどう使いますか？" with title "REIを始める" buttons {"やめる", "既存のREIに参加", "中心PCにする"} default button "中心PCにする")');
    if(!selection||selection==='やめる')return;
    mode=selection==='中心PCにする'?'hub':'connector';
    if(mode==='hub')saveMode(mode);
  }
  if(mode==='hub'){await host();return;}
  if(mode!=='connector')throw new Error('REIの起動設定が正しくありません');
  const config=process.env.REI_CONNECTOR_CONFIG||path.join(data,'connector.json');
  if(existsSync(config)){
    if(!lstatSync(config).isFile())throw new Error('参加PCの接続設定が通常のファイルではありません');
    if(serviceNeedsRepair('ai.rei.connector','connector.mjs'))repairService('connector');
    if(!existsSync(modeFile))saveMode('connector');
    notice('このMacはREIに登録済みです。中心PCのREI画面で接続端末の状態を確認してください。');return;
  }
  const url=dialog('text returned of (display dialog "中心PCのREI画面に表示された接続URLを貼り付けてください" with title "REIに参加" default answer "" buttons {"やめる", "次へ"} default button "次へ")');
  if(!url)return;
  const code=dialog('text returned of (display dialog "中心PCのREI画面に表示された16文字の接続コードを貼り付けてください" with title "REIに参加" default answer "" buttons {"やめる", "接続"} default button "接続")');
  if(!code)return;
  const result=spawnSync(process.execPath,[path.join(root,'connector.mjs'),'join',url],{cwd:root,env:{...process.env,REI_JOIN_CODE:code},encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
  if(result.status!==0)throw new Error((result.stderr||result.stdout||result.error?.message||'接続できませんでした').trim());
  saveMode('connector');
  notice('REIへの接続が完了しました。中心PCの「接続端末」で状態を確認してください。');
}
try {await main();} catch(error) {console.error(error);notice(`REIを起動できませんでした。${error.message}`);process.exitCode=1;}
