import { existsSync, lstatSync, mkdirSync, readFileSync, copyFileSync, chmodSync, linkSync, unlinkSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export function macosRuntimeExecutable(data,{source=process.execPath,version=process.version,arch=process.arch,platform=process.platform}={}) {
  if(platform!=='darwin'||!source.includes('.app/Contents/MacOS/'))return source;
  if(!/^v\d+\.\d+\.\d+$/.test(version)||!['arm64','x64'].includes(arch))throw new Error('Macの実行環境を確認できません');
  const directory=path.join(data,'runtime'),target=path.join(directory,`node-${version}-${arch}`);
  if(existsSync(directory)&&(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink()))throw new Error('REIの実行環境の保存先を確認してください');
  mkdirSync(directory,{recursive:true,mode:0o700});
  const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
  const expected=digest(source);
  const verify=()=>{if(!lstatSync(target).isFile()||lstatSync(target).isSymbolicLink()||digest(target)!==expected)throw new Error('保存済みのREI実行環境が同梱版と一致しません。上書きせず確認してください');};
  if(!existsSync(target)) {
    const temporary=`${target}.${process.pid}.tmp`;
    copyFileSync(source,temporary,constants.COPYFILE_EXCL);
    try {
      chmodSync(temporary,0o500);
      if(digest(temporary)!==expected)throw new Error('同梱実行環境のコピーを検証できません');
      try{linkSync(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;}
    } finally {unlinkSync(temporary);}
  }
  verify();chmodSync(target,0o500);return target;
}
