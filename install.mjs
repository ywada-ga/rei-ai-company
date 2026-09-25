import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode=process.argv[2];
if(!['hub','connector'].includes(mode))throw new Error('使い方: node install.mjs hub | connector');
if(Number(process.versions.node.split('.')[0])<24)throw new Error('Node.js 24以降が必要です');
const platform={darwin:'macos',win32:'windows',linux:'linux'}[process.platform];
if(!platform)throw new Error(`このOSの自動起動には未対応です: ${process.platform}`);
const root=path.dirname(fileURLToPath(import.meta.url));
const result=spawnSync(process.execPath,[path.join(root,`install-${platform}.mjs`),mode],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
