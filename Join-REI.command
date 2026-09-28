#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "REIにこのMacを追加します。"
echo "中心PCの『端末・設定 → かんたん端末追加』を開いてください。"
echo "接続URLと16文字の接続コードを順に入力します。"
echo

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo "Node.js 24以降が必要です。https://nodejs.org/ からインストールしてください。"
  read -r '?Enterキーで閉じます: '
  exit 1
fi

node connector.mjs join
result=$?
if (( result != 0 )); then
  echo
  echo "接続できませんでした。上の案内を確認してください。中心PCの接続コードが期限切れなら、新しいコードを作って再実行してください。"
fi
read -r '?Enterキーで閉じます: '
exit "$result"
