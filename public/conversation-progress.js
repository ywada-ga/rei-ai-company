// These are observable processing states, never model reasoning or company facts.
export const CONVERSATION_PROGRESS=Object.freeze({
  outline:'会社の記録を確認します。',
  search:'関連する記録を探しています。',
  source:'資料の本文を確認しています。',
  summarize:'確認した内容をまとめています。'
});
export function additionsProgress(count){
  if(!Number.isInteger(count)||count<0||count>512000)throw new Error('追加件数を確認できません');
  return `追加履歴で${count}件を確認しました。本文を読んでいます。`;
}
export function validProgressText(text){
  return Object.values(CONVERSATION_PROGRESS).includes(text)||/^追加履歴で\d{1,6}件を確認しました。本文を読んでいます。$/u.test(text);
}
