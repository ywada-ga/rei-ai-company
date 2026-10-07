// Prepare an offline voice runtime inside a macOS app. Never overwrite a bundle.
import {cpSync,mkdirSync,existsSync,readdirSync,copyFileSync,symlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const [targetArg,pythonArg,packagesArg,modelArg]=process.argv.slice(2);
if(!targetArg||!pythonArg||!packagesArg||!modelArg)throw new Error('Usage: node package-local-voice.mjs <new-bundle> <python-root> <site-packages> <model>');
const [target,python,packages,model]=[targetArg,pythonArg,packagesArg,modelArg].map(p=>path.resolve(p));
if(existsSync(target))throw new Error('Existing voice bundle is preserved');
if(!existsSync(path.join(python,'bin/python3.12'))||!existsSync(path.join(packages,'mlx_audio'))||!existsSync(path.join(model,'model.safetensors')))throw new Error('Voice assets are incomplete');
mkdirSync(path.join(target,'python/bin'),{recursive:true});
copyFileSync(path.join(python,'bin/python3.12'),path.join(target,'python/bin/python3.12'));
symlinkSync('python3.12',path.join(target,'python/bin/python3'));
// Exclude unrelated SDK packages and caches; preserve runtime libraries/licenses.
cpSync(path.join(python,'lib'),path.join(target,'python/lib'),{recursive:true,dereference:true,
  filter:p=>!p.split(path.sep).some(part=>['site-packages','__pycache__','pkgconfig'].includes(part))});
cpSync(packages,path.join(target,'python/lib/python3.12/site-packages'),{recursive:true,dereference:true,
  filter:p=>!p.split(path.sep).includes('__pycache__')});
cpSync(model,path.join(target,'qwen-model'),{recursive:true,dereference:true,
  filter:p=>!p.split(path.sep).some(part=>part.endsWith('.chunks')||part==='.cache')&&!p.endsWith('.part')});
const probe=spawnSync(path.join(target,'python/bin/python3'),['-c','import soundfile,mlx.core; from mlx_audio.tts.utils import load_model; print("offline imports OK")'],{
  env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8',timeout:120000});
if(probe.status!==0)throw new Error(`Relocated runtime import check failed: ${probe.stderr.slice(-1500)}`);
writeFileSync(path.join(target,'bundle.json'),JSON.stringify({model:'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit',revision:'41d3337e8b7f2843a75841595fc14e4b9a7a4b96',python:'3.12',modelLicense:'Apache-2.0',licenseReview:'Dependency notices must be reviewed before commercial release'},null,2));
console.log(probe.stdout.trim());console.log('Local voice bundle prepared');
