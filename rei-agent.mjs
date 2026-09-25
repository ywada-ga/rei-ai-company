import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOpenClawCli } from './openclaw-process.mjs';

const instructions={
  'AGENTS.md':'# REI の仕事\n\nあなたはREI AI Companyから計画と実行を任された専用エージェントです。計画担当として呼ばれた場合は実行せず、指定されたJSON形式だけで工程を返します。実行担当として呼ばれた場合は作業を進め、実施内容、成果物、未実施の部分を区別して日本語で報告します。REIの依頼にない外部送信や認証情報の公開、他のOpenClawエージェントの設定変更は行いません。個人用エージェントの会話や記憶を参照しません。\n',
  'SOUL.md':'# REI\n\nREIは利用者の指示を仕事に分け、各PCの担当AIや人につなぐ秘書AIです。日本語で明確かつ簡潔に応答し、個人用アシスタントとは独立して動きます。\n',
  'IDENTITY.md':'# Identity\n\n- Name: REI\n- Theme: AI company executive assistant\n- Emoji: ◈\n',
  'USER.md':'# 利用者\n\nREIへログインした利用者から、REI Hub経由で仕事を受け取ります。タイムゾーンはAsia/Tokyoです。\n'
};

function checked(command,args) {
  const result=command(args);
  if(result.error||result.status!==0)throw new Error(`OpenClawのREI専用エージェントを設定できません: ${String(result.stderr||result.error?.message||result.stdout||'').slice(-350)}`);
  return String(result.stdout||'');
}
export function ensureReiAgent(root,command=runOpenClawCli) {
  const workspace=path.join(root,'data','openclaw-workspace');
  const agents=JSON.parse(checked(command,['agents','list','--json']));
  const existing=agents.find(agent=>agent.id==='rei');
  if(existing&&path.resolve(existing.workspace||'')!==path.resolve(workspace))throw new Error('既存のreiエージェントは別の用途で使われています。REI用の名前を変更してから再試行してください');
  if(!existing) {
    const configFile=checked(command,['config','file']).trim().replace(/^~(?=\/)/,os.homedir());
    const backupDir=path.join(root,'data','private-backups');
    mkdirSync(backupDir,{recursive:true,mode:0o700});
    if(existsSync(configFile)) {const backup=path.join(backupDir,'openclaw-before-rei.json');if(!existsSync(backup)){copyFileSync(configFile,backup);chmodSync(backup,0o600);}}
    checked(command,['agents','add','rei','--workspace',workspace,'--non-interactive','--json']);
    mkdirSync(workspace,{recursive:true,mode:0o700});
    for(const [name,content] of Object.entries(instructions))writeFileSync(path.join(workspace,name),content,{mode:0o600});
    rmSync(path.join(workspace,'BOOTSTRAP.md'),{force:true});
    checked(command,['agents','set-identity','--agent','rei','--identity-file',path.join(workspace,'IDENTITY.md'),'--json']);
  }
  const config=JSON.parse(checked(command,['config','get','agents']));
  const target=Array.isArray(config.list)?config.list.findIndex(agent=>agent.id==='rei'):-1;
  const entry=target>=0?config.list[target]:config.entries?.rei;
  if(!entry)throw new Error('REI専用エージェントの設定を確認できません');
  const required=['message','sessions_send','gateway'];
  const deny=[...new Set([...(entry.tools?.deny||[]),...required])];
  if(deny.length!==(entry.tools?.deny||[]).length) {
    const key=target>=0?`agents.list[${target}].tools.deny`:'agents.entries.rei.tools.deny';
    checked(command,['config','set',key,JSON.stringify(deny),'--strict-json']);
  }
  checked(command,['config','validate']);
  return {agent:'rei',workspace,created:!existing};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv[2]!=='setup')throw new Error('使い方: node rei-agent.mjs setup');
  const result=ensureReiAgent(path.dirname(fileURLToPath(import.meta.url)));
  console.log(result.created?'REI専用エージェントを作成しました':'REI専用エージェントは準備済みです');
}
