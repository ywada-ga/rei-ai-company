import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.REI_PORT||4178);
if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('REI_PORTは1〜65535で指定してください');
const url=`http://127.0.0.1:${port}/`;

function openBrowser(target) {
  console.log(`REIの画面: ${target}`);
  if(process.env.REI_NO_BROWSER==='1')return;
  const [command,args]=process.platform==='darwin'?['open',[target]]:
    process.platform==='win32'?['cmd.exe',['/c','start','',target]]:['xdg-open',[target]];
  const browser=spawn(command,args,{stdio:'ignore',windowsHide:true});
  browser.on('error',error=>console.error(`ブラウザを開けませんでした。上のURLを開いてください: ${error.message}`));
  browser.unref();
}

let running=false;
try {
  const response=await fetch(`${url}api?route=setup%2Fstatus`,{signal:AbortSignal.timeout(2000)});
  if(response.ok)running=typeof (await response.json()).needsSetup==='boolean';
} catch { /* No REI is running on this port. */ }
if(running) {
  console.log('起動中のREIを開きます。');
  openBrowser(url);
} else {
  const child=spawn(process.execPath,[path.join(root,'hub.mjs')],{cwd:root,env:process.env,stdio:['inherit','pipe','inherit']});
  child.stdout.setEncoding('utf8');
  let output='',setupUrl='',opened=false;
  child.stdout.on('data',chunk=>{
    process.stdout.write(chunk);
    output=(output+chunk).slice(-4000);
    const setup=output.match(/REIの初期登録: (http:\/\/[^\s]+)/);
    if(setup)setupUrl=setup[1];
    if(!opened&&output.includes('REI Hub: ')) {opened=true;openBrowser(setupUrl||url);}
  });
  child.on('error',error=>{console.error(`REIを起動できませんでした: ${error.message}`);process.exitCode=1;});
  child.on('close',code=>{process.exitCode=code??1;});
  process.on('SIGINT',()=>child.kill('SIGINT'));
  process.on('SIGTERM',()=>child.kill('SIGTERM'));
}
