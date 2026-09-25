# REIの更新と復旧

この手順は、GitHubから取得したREIを同じPC上で更新する場合に使います。REIの仕事・利用者・端末・トークンは `data/` にあり、Gitには含まれません。各PCのREIを更新する場合は、そのPCごとに行ってください。Gitで取得した場合は下の手順、GitHubのZIPから始めた場合は「ZIPからの更新」を使います。

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
中心PCでは `npm run doctor:hub`、各参加PCでは `npm run doctor` を実行すると、データベース・バックアップと端末接続を確認できます。

## ZIPからの更新

1. 旧版の画面で実行中の工程がないことを確認し、旧版の中心PCでバックアップを作成します。外部バックアップ先を指定していた場合は、その `REI_BACKUP_DIR` を付けて `node backup.mjs create` を実行してください。
2. GitHubから新しいZIPを取得して**別のフォルダ**に展開します。旧版のフォルダと `data/` は削除・上書きしません。新しいフォルダのREIに、旧版で使用していたデータ保存先を絶対パスの `REI_DATA_DIR` で渡します。旧版の既定値を使っていた場合は「旧版のフォルダ/data」です。既に別の `REI_DATA_DIR` を設定していた場合は、同じ値を使います。
3. 自動起動を使っているMac・Linuxでは、新しいフォルダでデータ保存先を指定します。外部バックアップ先や工程期限を指定していた場合は、同じ環境変数も再設定してください。その後、中心PCでは `npm run install:hub`、参加PCでは `npm run install:connector` を実行します。同じPCで両方動かしている場合だけ両方実行します。起動設定は新しいフォルダへ切り替わり、サービスが再起動します。

```bash
cd /新しいREIのフォルダ
export REI_DATA_DIR='/旧版のREIのフォルダ/data'
```

Windowsで自動起動を使っている場合は、PowerShellで新しいフォルダへ移り、以下を実行します。`REI_NO_START=1` は旧版が動いている間に新版を二重起動しないための指定です。中心PCか参加PCの**使っている方の登録だけ**実行してください。両方使っているPCでは両方登録します。登録後にWindowsからサインアウトして再サインインすると新版が起動します。

```powershell
cd 'C:\新しいREIのフォルダ'
$env:REI_DATA_DIR='C:\旧版のREIのフォルダ\data'
$env:REI_NO_START='1'
```

この設定をしたPowerShellで、中心PCは `npm run install:hub`、参加PCは `npm run install:connector` を実行します。同じPCで両方動かしている場合だけ両方実行します。

手動起動の場合は、旧版のHubとConnectorを終了してから、新しいフォルダで同じ `REI_DATA_DIR` を指定し、Hubは `npm run launch`、Connectorは `npm run connector` を起動します。新版の起動後に中心PCで `npm run doctor:hub`、参加PCで `npm run doctor` を実行し、以前の仕事と端末が残っていることを確認します。診断でも同じ `REI_DATA_DIR` と外部バックアップ先の設定を使ってください。旧版のフォルダはデータとOpenClawの作業場所を参照している場合があるため、整理する前に新しい保存先への移行を計画してください。

## 更新を戻す

更新前に作業ツリーが空だった場合は、控えたコミットIDを指定して `git reset --hard <更新前のコミットID>` でコードを戻せます。この操作は追跡対象ファイルに加えた更新後の変更を破棄するため、更新後に編集したファイルがある場合は先に退避してください。`data/` はGitの管理対象外ですが、コードを戻す前にバックアップが残っていることを確認してください。その後、上記のOS別の手順でHubとConnectorを再起動します。

ZIPから更新した場合は旧版のフォルダが残っています。新版のサービスを止め、旧版のフォルダで同じ `REI_DATA_DIR` を指定して、上記のOS別の自動起動登録または手動起動をやり直します。データ形式が新版で更新されている場合は、次の段落に従って更新前のバックアップも復元してください。

データの復元が必要な場合は、`node backup.mjs verify <バックアップフォルダ>` で確認し、`node backup.mjs restore <バックアップフォルダ> <新しい空のフォルダ>` で別の場所に展開します。稼働中の `data/` を直接上書きしません。復元先で内容を確認してから、HubとこのPCのConnectorの `REI_DATA_DIR` に同じフォルダを指定します。自動起動の設定はその環境変数を指定して各OSのインストーラーを再実行します。

新しい版でデータ形式が更新されると、古いREIはそのデータを変更せず起動を止めます。コードだけを戻して起動できない場合は、更新前のバックアップを新しいフォルダへ復元して、上記の `REI_DATA_DIR` で切り替えてください。
