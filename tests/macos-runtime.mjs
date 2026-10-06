import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {macosRuntimeExecutable} from '../macos-runtime.mjs';
if(process.platform==='win32'){console.log('SKIP macOS runtime cache on Windows');process.exit(0);}
const dir=mkdtempSync(path.join(os.tmpdir(),'rei-runtime-')),source=path.join(dir,'REI.app/Contents/MacOS/node'),data=path.join(dir,'data');mkdirSync(path.dirname(source),{recursive:true});writeFileSync(source,'verified bundled runtime');const options={source,version:'v24.21.0',arch:'arm64',platform:'darwin'};
try {
 const target=macosRuntimeExecutable(data,options);assert.equal(readFileSync(target,'utf8'),'verified bundled runtime');assert.equal(macosRuntimeExecutable(data,options),target);
 writeFileSync(source,'different binary');assert.throws(()=>macosRuntimeExecutable(data,options),/上書きせず/);assert.equal(readFileSync(target,'utf8'),'verified bundled runtime');
 const second=path.join(dir,'second');mkdirSync(second);symlinkSync(path.join(data,'runtime'),path.join(second,'runtime'));assert.throws(()=>macosRuntimeExecutable(second,options),/保存先/);
 assert.equal(macosRuntimeExecutable(data,{...options,source:'/usr/local/bin/node'}),'/usr/local/bin/node');
 console.log('PASS macOS cached runtime is verified and conflicting or linked saved data is protected');
}finally{rmSync(dir,{recursive:true,force:true});}
