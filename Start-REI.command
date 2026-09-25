#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24以降が必要です。https://nodejs.org/ からインストールしてください。"
  read -r '?Enterキーで閉じます: '
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo "Node.js 24以降へ更新してください。https://nodejs.org/"
  read -r '?Enterキーで閉じます: '
  exit 1
fi
node launch.mjs
result=$?
if (( result != 0 )); then
  echo "REIを起動できませんでした。上のエラーを確認してください。"
  read -r '?Enterキーで閉じます: '
fi
exit "$result"
