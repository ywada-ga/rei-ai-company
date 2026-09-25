# REI — ローカルで動くAI会社の司令室

REIは、1台の「中心PC」にプロジェクト・仕事・権限・履歴を保存し、各PCのConnectorを通じてそのPCのOpenClawに仕事を渡します。中心PCも参加端末もmacOSまたはWindowsを使えます。Web画面は中心PC上で動きます。クラウドやVercel、外部データベースは不要です。

## 必要なもの

- Node.js 24以降
- 実行に参加する各PCのOpenClaw CLIと、利用可能なエージェント（Windows HubアプリだけではCLIが使えるとは限りません）
- 遠隔の複数PCの場合、同じTailscaleネットワークへの参加（手動方式ではSSH接続も可）
- 人に依頼する場合だけChatwork APIトークンとルームID

## 1台で始める

```bash
git clone https://github.com/ywada-ga/rei-ai-company.git rei
cd rei
npm start
```

初回起動時にターミナルへ出る「REIの初期登録」URLを開き、所有者の名前と14文字以上のパスワードを設定します。続けてログインします。画面右上の **端末・設定** から「このPC」を登録し、発行されたトークンを一度だけ控えます。既存のOpenClawを別用途でも使う場合は、REI専用エージェントを作ります。

```bash
npm run agent:setup
npm run connector -- setup
```

接続先は `http://127.0.0.1:4178`、次に端末トークンとOpenClawエージェント名 `rei` を入力します。**既存のOpenClawをREI専用に変えてよい場合**は、上の `npm run agent:setup` の代わりに `npm run agent:reuse-main` を実行し、エージェント名に `main` を入力します。元のOpenClaw設定は `data/private-backups/` に退避します。どちらも設定を保存したら別のターミナルで `npm run connector` を起動します。Web画面から仕事を依頼すると、REIが計画を作り、このPCのOpenClawで実行します。

macOSのログイン時に自動起動したい場合:

```bash
node install-macos.mjs hub
node install-macos.mjs connector
```

WindowsではPowerShellでこのリポジトリを取得し、同じ `npm start` と `node connector.mjs join` を使えます。Windowsのログイン時にREI本体を自動起動する場合は `node install-windows.mjs hub` を実行します。Windowsの参加端末では `join` がConnectorを自動起動に登録します。OpenClaw CLIは[公式Windows手順](https://github.com/openclaw/openclaw/blob/main/docs/platforms/windows.md)で用意してください。

## Mac mini・Windows PCをかんたんに追加する（遠隔も可）

1. 中心PCと各参加PCに[Tailscale](https://tailscale.com/download)を入れ、同じネットワークへログインします。
2. 中心PCのREIで **端末・設定 → 安全な接続を有効にする** を押します。REIが接続URLを検出して入力欄へ入れます。Tailscale側でHTTPSを有効にする案内が出た場合は、その案内を完了してください。
3. REIの **端末・設定 → かんたん端末追加** にPCの名前を入力します。10分間だけ使える接続コードが表示されます。
4. 参加PCでは、画面に表示されたコマンドを実行し、接続URLとコードを入力します。OpenClaw CLIを確認した後、個人用とは別の `rei` エージェントを作り、Connectorをログイン時の自動起動に登録します。WindowsではPowerShellに表示された3行を順に入力します。

各PCにはNode.js 24以降とOpenClaw CLIが必要です。TailscaleへのログインとOpenClawの設定は最初の一度だけ必要です。接続コードは使用後に失効します。中心PCのREIは引き続き `127.0.0.1` にだけ待ち受け、Tailscale Serveが暗号化した入口を担当します。[Tailscale Serveの公式説明](https://tailscale.com/docs/features/tailscale-serve)も参照してください。Windowsで中心PCを運用する場合、Serveの有効化は[管理者ターミナル](https://tailscale.com/docs/reference/examples/serve)から行います。

計画担当のPCが30秒以上応答しない場合、計画機能のある接続中の別PCが新しい計画を引き継ぎます。途中で通信が切れた実行作業は二重実行を避けるため自動でやり直さず、画面に「要確認」と表示します。

## Mac miniをSSHで追加する（手動方式）

中心PCにはmacOSの **リモートログイン** を有効にし、Mac miniからSSH鍵で接続できるようにします。まずMac miniで次を試します。

```bash
ssh user@hub-mac
```

次に、中心PCのREIは `127.0.0.1:4178` のまま維持し、Mac miniごとに暗号化したSSH転送を作ります。例:

```bash
ssh -N -L 127.0.0.1:4179:127.0.0.1:4178 user@hub-mac
```

Mac miniのブラウザで `http://127.0.0.1:4179` を開けることを確認します。中心PCの画面でそのMac miniの端末トークンを発行します。Mac miniにもこのリポジトリとOpenClawを置き、`npm run agent:setup` で専用エージェントを作ります。`npm run connector -- setup` で接続先 `http://127.0.0.1:4179`、発行されたトークン、エージェント名 `rei` を設定します。`npm run connector` で参加します。**3台それぞれに別のトークンを発行**してください。

SSH鍵による接続ができた後は、Mac miniごとに以下で自動起動できます。

```bash
node install-macos.mjs tunnel
node install-macos.mjs connector
```

トンネル用インストーラーに `user@hub-mac` を入力します。ローカルの4179番を使うため、そのMacに同ポートの別サービスがある場合は手動で転送ポートを変更してください。SSH接続先が別ネットワークにある場合は、VPN/Tailscale等でSSH到達性を確保します。REI Hubを認証なしでLANやインターネットへ直接公開しません。

## カレンダー・メールなどのMCP連携

所有者は **端末・設定 → MCP連携** から、利用するPCと連携先を検索し、チェックして一括登録できます。国内向けのfreee、マネーフォワード クラウド会計・事業者情報、Misoca、kintone公式ドキュメント検索、SUZURIに加え、Meeting.ai、Notion、Linear、Jira・Confluence、Google Workspace、Context7、Supabase、Sentry、Cloudflare、Upstash、Exa、Firecrawl、Stripeを選べます。画面には認証方式、利用条件、公式手順を表示します。対応範囲と調査結果は [MCP_JAPAN_CATALOG.md](MCP_JAPAN_CATALOG.md) と [MCP_TREND_CATALOG.md](MCP_TREND_CATALOG.md) に記録しています。REI ConnectorがそのPCのOpenClawへ `rei_` で始まる専用設定を反映します。既存のOpenClaw MCP設定には触れません。解除も対象PCが次に接続した時に反映されます。対象PCが停止中なら、画面では反映待ちになります。

OAuthが必要な場合は、対象PCで画面に表示される `openclaw mcp login rei_...` を一度実行し、サービス側のログインを完了してください。OAuthトークンは対象PCのOpenClawに保存され、REIのHubには保存されません。REIの「登録済み」はOpenClawへの設定反映を表します。実際の外部サービスとの通信は、次の接続確認を実行して判定します。

各連携の **接続を確認** を押すと、対象PCのConnectorがOpenClawのMCP検査を実行し、通信結果と公開ツール数をREIへ返します。**接続状態を更新** で結果を表示します。端末が停止している間は確認待ちとなり、再接続後に検査します。認証待ちの状態も区別して表示します。

Google Workspaceの公式MCPは開発者向けプレビューです。Google Workspace Developer Previewへの参加やCloudプロジェクト、OAuthクライアントなど、Google側の準備が必要です。freeeは公式案内でAgent Skillsの導入も必須とされています。マネーフォワード クラウド会計はアプリポータル側の権限設定、Misocaは有償プランが必要です。一般のMCPはサーバー側が提供するHTTPS URLと認証方式を入力してください。現時点で対応するのはStreamable HTTPで、ローカル起動型（stdio）やAPIキーの入力には対応していません。

## Chatworkで人に依頼する

所有者が **端末・設定** からルームIDとAPIトークンを登録します。REIが人の担当と判断した子仕事は、そのルームへ `[REI:仕事ID]` 付きで投稿します。担当者は同じタグを含めて返信します。Hubが約30秒ごとに返信を照合し、元の仕事へ記録します。トークンはこのPC内で暗号化して保存します。接続設定がない場合、人への仕事は待機し、送信しません。

Chatworkの設定前でも、所有者または管理者は **ミッション → 担当と進行状況** から人への回答を入力できます。回答は仕事の履歴に記録され、親仕事の完了判定にも反映されます。Chatworkへ送信済みの依頼も画面から回答を記録できます。

## 権限

所有者と管理者は仕事を直接依頼できます。依頼者の仕事は承認待ちになり、所有者か管理者の承認後に実行されます。閲覧者は状況を見るだけです。所有者と管理者は設定画面から招待リンクを発行でき、管理者を招待できるのは所有者だけです。所有者は利用者の権限変更と利用停止・再開もできます。停止時はその利用者のログインを解除します。端末ごとのトークンは解除時に失効します。
利用者は設定画面で自分のパスワードを変更できます。

## プロジェクトで仕事をまとめる

左の **プロジェクト** から目的を作り、画面下の依頼欄でプロジェクトを選ぶと、その仕事と計画・実行の子仕事が同じ案件に記録されます。目的は担当AIにも渡されます。プロジェクト画面には依頼数、完了数、要確認数、最近の仕事を表示します。所有者と管理者はプロジェクトを「稼働中」「保留」「完了」に変更できます。保留・完了中のプロジェクトには新しい依頼を追加できません。既存の仕事はそのまま履歴に残り、進行中の仕事は状態変更後も続行します。

**ミッション** の詳細には計画・実行・人への依頼の各工程と履歴を表示します。実行前の仕事は作成者、所有者、管理者が中止できます。AIや人がすでに動き始めた仕事は、この操作では中止できません。「内容を再入力」で元の指示を入力欄に戻し、確認してから改めて依頼できます。

通信断などで工程が「要確認」になった場合、所有者か管理者は実際の端末・成果物・担当者を確認してから、工程の「確認結果」に実施済みまたは未実施・失敗と根拠を記録できます。実施済みの確認がすべて揃うと親の仕事も完了になります。確認結果は履歴に残ります。

## データと安全上の境界

- `data/rei.sqlite`: 仕事、利用者、端末、履歴。Gitには含めません。
- `data/connector.json`: 端末トークン。Gitには含めません。権限 `0600`。
- `data/chatwork.key`: Chatworkトークンの暗号鍵。Gitには含めません。バックアップする場合はDBと一緒に保管します。
- このPCで作成済みの所有者認証情報は `data/owner-credentials.txt` に保存しました。公開リポジトリには含めません。ログイン後に設定画面でパスワードを変更できます。
- Connectorは接続先がHTTPS、またはSSH転送したlocalhostの場合にだけ起動します。
- MCP連携を追加した場合、対象PCのOpenClaw設定に `rei_` で始まる専用項目を追加します。それ以外の既存MCP設定は変更しません。かんたん端末追加では、個人用と別のワークスペース・会話履歴を持つ `rei` エージェントを作ります。既存の `main` をREI用に変更する選択肢もあります。どちらもREI経由以外のメッセージ送信とGateway管理のツールを無効にします。これだけでOS上のファイルアクセスを制限できるわけではないため、クライアント配布時は端末ごとにOpenClawのツール権限と作業場所を確認してください。
- 長時間実行の通信が失われた仕事は、二重実行を避けるため「要確認」にします。
- 計画だけが失敗した仕事は、所有者・管理者がミッション詳細から再実行できます。実行結果が不明な工程は、端末で確認した結果を記録してください。

## バックアップと復元

所有者は **端末・設定 → バックアップを作成** から、REIの稼働中にSQLiteの整合した写しを作れます。保存先は中心PCの `data/backups/` です。仕事・利用者・端末・Chatwork暗号鍵・このPCのConnector設定を含みます。バックアップには認証情報が入るため、フォルダの権限は所有者だけに制限します。別の故障にも備えるには、作成後のフォルダを外部ストレージへコピーしてください。`owner-credentials.txt` は含みません。

```bash
node backup.mjs create
node backup.mjs verify /保存したバックアップのフォルダ
node backup.mjs restore /保存したバックアップのフォルダ /新しい空の復元先
```

復元は既存データを上書きせず、必ず新しいフォルダに展開します。検証ではファイルのSHA-256とSQLiteの整合性を確認します。復元後はHubを停止し、`REI_DATA_DIR` を復元先に指定して起動してください。端末トークンなどの秘密情報を含むため、バックアップを公開リポジトリに追加しないでください。

## 実装と現状

Web司令室、ログイン、役割、端末登録・解除、複数PC用Connector、OpenClaw計画・実行、結果集約、日次報告、Chatwork送受信、PCごとのMCP設定配信、macOS自動起動を実装しています。このPCのOpenClawとの通し確認は完了しています。**Mac mini 3台とChatworkは、接続先や資格情報をまだ受け取っていないため実機接続は未完了**です。ChatGPTデスクトップアプリの会話を直接操作する機能はありません。

開発・配布前の残課題は [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) に記録します。
