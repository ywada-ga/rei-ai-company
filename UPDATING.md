# REIの更新と復旧

この手順は、GitHubから取得したREIを同じPC上で更新する場合に使います。REIの仕事・利用者・端末・トークンは `data/` にあり、Gitには含まれません。各PCのREIを更新する場合は、そのPCごとに行ってください。

## 更新前

1. REI画面で実行中の工程がないことを確認します。実行中にHubやConnectorを止めると、結果が「要確認」になる場合があります。更新中は新しい仕事を投入しないでください。
2. REIのフォルダで `git status --short` を実行します。変更が表示された場合は、内容を確認してから更新してください。
3. 中心PCで `node backup.mjs create` を実行します。表示されたバックアップフォルダは、可能なら外部ストレージにもコピーします。
4. `git rev-parse HEAD` の結果を控えます。更新前のコードへ戻すときに使います。

## 更新

REIのフォルダで次を実行します。

```bash
git pull --ff-only
npm run check
npm test
```

`git pull --ff-only` が止まった場合は、ローカルの変更や履歴の食い違いがあります。強制更新は行わず、変更内容を確認してください。テストが失敗した場合はサービスを再起動せず、エラーを確認してください。

## 反映

- **macOS:** 自動起動を登録済みなら、HubのPCで `launchctl kickstart -k gui/$(id -u)/ai.rei.hub`、ConnectorのPCで `launchctl kickstart -k gui/$(id -u)/ai.rei.connector` を実行します。両方を登録しているPCでは両方実行します。手動起動中なら、該当するプロセスを終了し、Hubは `npm start`、Connectorは `npm run connector` で起動し直します。
- **Linux:** systemdユーザーサービスを登録済みなら、HubのPCで `systemctl --user restart rei-hub.service`、ConnectorのPCで `systemctl --user restart rei-connector.service` を実行します。両方を登録しているPCでは両方実行します。手動起動中なら、該当するプロセスを終了し、Hubは `npm start`、Connectorは `npm run connector` で起動し直します。
- **Windows:** 自動起動中のHubとConnectorは、実行中の仕事がない状態でWindowsからサインアウトし、再度サインインして起動し直します。手動起動中なら、各ターミナルを終了して `npm start` と `npm run connector` で起動し直します。

最後にREI画面を更新し、接続端末がオンラインになり、以前の仕事と利用者が残っていることを確認します。

## 更新を戻す

更新前に作業ツリーが空だった場合は、控えたコミットIDを指定して `git reset --hard <更新前のコミットID>` でコードを戻せます。この操作は追跡対象ファイルに加えた更新後の変更を破棄するため、更新後に編集したファイルがある場合は先に退避してください。`data/` はGitの管理対象外ですが、コードを戻す前にバックアップが残っていることを確認してください。その後、上記のOS別の手順でHubとConnectorを再起動します。

データの復元が必要な場合は、`node backup.mjs verify <バックアップフォルダ>` で確認し、`node backup.mjs restore <バックアップフォルダ> <新しい空のフォルダ>` で別の場所に展開します。稼働中の `data/` を直接上書きしません。復元先で内容を確認してから、HubとこのPCのConnectorの `REI_DATA_DIR` に同じフォルダを指定します。自動起動の設定はその環境変数を指定して各OSのインストーラーを再実行します。
