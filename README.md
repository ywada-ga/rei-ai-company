# REI — ローカルで動くAI会社の司令室

REIは、1台の「中心PC」に仕事・権限・履歴を保存し、各PCのConnectorを通じてそのPCのOpenClawに仕事を渡します。Web画面は中心PC上で動きます。クラウドやVercel、外部データベースは不要です。

## 必要なもの

- Node.js 24以降
- 実行に参加する各PCのOpenClawと、利用可能なエージェント
- 複数PCの場合、中心PCへのSSH接続（または同等の暗号化されたローカル転送）
- 人に依頼する場合だけChatwork APIトークンとルームID

## 1台で始める

```bash
git clone https://github.com/ywada-ga/rei-ai-company.git rei
cd rei
npm start
```

初回起動時にターミナルへ出る「REIの初期登録」URLを開き、所有者の名前と14文字以上のパスワードを設定します。続けてログインします。画面右上の **端末・設定** から「このPC」を登録し、発行されたトークンを一度だけ控えます。

```bash
npm run connector -- setup
```

接続先は `http://127.0.0.1:4178`、次に端末トークンとOpenClawエージェント名（通常は `main`）を入力します。設定を保存したら別のターミナルで `npm run connector` を起動します。Web画面から仕事を依頼すると、REIが計画を作り、このPCのOpenClawで実行します。

macOSのログイン時に自動起動したい場合:

```bash
node install-macos.mjs hub
node install-macos.mjs connector
```

## Mac miniを追加する

中心PCにはmacOSの **リモートログイン** を有効にし、Mac miniからSSH鍵で接続できるようにします。まずMac miniで次を試します。

```bash
ssh user@hub-mac
```

次に、中心PCのREIは `127.0.0.1:4178` のまま維持し、Mac miniごとに暗号化したSSH転送を作ります。例:

```bash
ssh -N -L 127.0.0.1:4179:127.0.0.1:4178 user@hub-mac
```

Mac miniのブラウザで `http://127.0.0.1:4179` を開けることを確認します。中心PCの画面でそのMac miniの端末トークンを発行します。Mac miniにもこのリポジトリとOpenClawを置き、`npm run connector -- setup` で接続先 `http://127.0.0.1:4179` と発行されたトークンを設定します。`npm run connector` で参加します。**3台それぞれに別のトークンを発行**してください。

SSH鍵による接続ができた後は、Mac miniごとに以下で自動起動できます。

```bash
node install-macos.mjs tunnel
node install-macos.mjs connector
```

トンネル用インストーラーに `user@hub-mac` を入力します。ローカルの4179番を使うため、そのMacに同ポートの別サービスがある場合は手動で転送ポートを変更してください。SSH接続先が別ネットワークにある場合は、VPN/Tailscale等でSSH到達性を確保します。REI Hubを認証なしでLANやインターネットへ直接公開しません。

## Chatworkで人に依頼する

所有者が **端末・設定** からルームIDとAPIトークンを登録します。REIが人の担当と判断した子仕事は、そのルームへ `[REI:仕事ID]` 付きで投稿します。担当者は同じタグを含めて返信します。Hubが約30秒ごとに返信を照合し、元の仕事へ記録します。トークンはこのPC内で暗号化して保存します。接続設定がない場合、人への仕事は待機し、送信しません。

## 権限

所有者と管理者は仕事を直接依頼できます。依頼者の仕事は承認待ちになり、所有者か管理者の承認後に実行されます。閲覧者は状況を見るだけです。所有者は設定画面から招待リンクを発行できます。端末ごとのトークンは解除時に失効します。
利用者は設定画面で自分のパスワードを変更できます。

## データと安全上の境界

- `data/rei.sqlite`: 仕事、利用者、端末、履歴。Gitには含めません。
- `data/connector.json`: 端末トークン。Gitには含めません。権限 `0600`。
- `data/chatwork.key`: Chatworkトークンの暗号鍵。Gitには含めません。バックアップする場合はDBと一緒に保管します。
- このPCで作成済みの所有者認証情報は `data/owner-credentials.txt` に保存しました。公開リポジトリには含めません。ログイン後に設定画面でパスワードを変更できます。
- Connectorは接続先がHTTPS、またはSSH転送したlocalhostの場合にだけ起動します。
- OpenClawの既存設定は変更しません。初期値では既存の `main` エージェントを利用します。実運用ではREI専用エージェントを設け、OpenClaw側のツール権限も設定してください。
- 長時間実行の通信が失われた仕事は、二重実行を避けるため「要確認」にします。

## 実装と現状

Web司令室、ログイン、役割、端末登録・解除、複数PC用Connector、OpenClaw計画・実行、結果集約、日次報告、Chatwork送受信、macOS自動起動を実装しています。このPCのOpenClawとの通し確認は完了しています。**Mac mini 3台とChatworkは、接続先や資格情報をまだ受け取っていないため実機接続は未完了**です。ChatGPTデスクトップアプリの会話を直接操作する機能はありません。

開発・配布前の残課題は [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) に記録します。
