import { existsSync, lstatSync, readlinkSync, readdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';

function* links(dir) {
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const target=path.join(dir,entry.name);
    if(entry.isSymbolicLink())yield target;
    else if(entry.isDirectory())yield* links(target);
  }
}

export function localizeLinks(source,destination) {
  const sourceRoot=realpathSync(source);
  for(const link of links(destination)) {
    const current=readlinkSync(link);
    const sourceLink=path.join(sourceRoot,path.relative(destination,link));
    const sourceTarget=realpathSync(path.resolve(path.dirname(sourceLink),current));
    const relative=path.relative(sourceRoot,sourceTarget);
    if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))
      throw new Error(`OpenClawのアプリ外を参照するリンクがあります: ${path.relative(destination,link)}`);
    const bundledTarget=path.join(destination,relative);
    if(!existsSync(bundledTarget)||lstatSync(bundledTarget).isSymbolicLink())
      throw new Error(`OpenClawのリンク先を同梱できません: ${path.relative(destination,link)}`);
    unlinkSync(link);
    symlinkSync(path.relative(path.dirname(link),bundledTarget),link);
  }
}
