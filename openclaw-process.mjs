import { spawn, spawnSync } from 'node:child_process';

const powershell=process.env.REI_POWERSHELL||'powershell.exe';
const encoded=script=>Buffer.from(`$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); ${script}`,'utf16le').toString('base64');
const winArgs=script=>['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',encoded(script)];

export function checkOpenClaw() {
  if(process.platform==='win32')return spawnSync(powershell,winArgs('& openclaw.cmd --version; exit $LASTEXITCODE'),{encoding:'utf8',windowsHide:true});
  return spawnSync('openclaw',['--version'],{encoding:'utf8'});
}

export function spawnOpenClaw(agent,key,instruction) {
  if(process.platform==='win32') {
    const script='& openclaw.cmd agent --agent $env:REI_OC_AGENT --session-key $env:REI_OC_SESSION --message $env:REI_OC_MESSAGE --json --timeout 180; exit $LASTEXITCODE';
    return spawn(powershell,winArgs(script),{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,REI_OC_AGENT:agent,REI_OC_SESSION:key,REI_OC_MESSAGE:instruction}});
  }
  return spawn('openclaw',['agent','--agent',agent,'--session-key',key,'--message',instruction,'--json','--timeout','180'],{stdio:['ignore','pipe','pipe']});
}
