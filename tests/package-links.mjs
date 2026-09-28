import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localizeLinks } from '../package-links.mjs';

if(process.platform==='win32') {
  console.log('package link test skipped on Windows');
} else {
  const root=mkdtempSync(path.join(os.tmpdir(),'rei-package-links-'));
  try {
    const source=path.join(root,'source');
    const destination=path.join(root,'destination');
    mkdirSync(path.join(source,'node_modules','.bin'),{recursive:true});
    mkdirSync(path.join(source,'node_modules','example'),{recursive:true});
    const target=path.join(source,'node_modules','example','cli.js');
    writeFileSync(target,'bundled command');
    symlinkSync(target,path.join(source,'node_modules','.bin','example'));
    cpSync(source,destination,{recursive:true});
    localizeLinks(source,destination);
    const link=path.join(destination,'node_modules','.bin','example');
    assert.equal(path.isAbsolute(readlinkSync(link)),false);
    assert.equal(readFileSync(link,'utf8'),'bundled command');

    const outside=path.join(root,'outside');
    writeFileSync(outside,'outside');
    const bad=path.join(source,'node_modules','.bin','outside');
    symlinkSync(outside,bad);
    const destination2=path.join(root,'destination2');
    cpSync(source,destination2,{recursive:true});
    assert.throws(()=>localizeLinks(source,destination2),/アプリ外/);
    console.log('package link tests passed');
  } finally {
    rmSync(root,{recursive:true,force:true});
  }
}
