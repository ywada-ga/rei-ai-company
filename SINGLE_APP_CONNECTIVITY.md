# REI単体での端末接続: 実装方針

## 利用者が行う操作

1. 各Macへ同じREIアプリを1回だけ入れる。Node.js、OpenClaw CLI、VPNアプリを別々にダウンロードさせない。
2. 中心Macで「このMacを中心にする」を選び、接続コードまたはQRコードを作る。
3. 参加Macで「既存のREIに参加する」を選び、コードを読み取るか入力する。
4. 同じネットワークなら直接接続する。別のネットワークなら、利用者が許可した場合だけ暗号化中継を使う。参加端末ごとの許可・解除は中心Macの画面で行う。

会社と自宅のMacのように離れた端末も対象にする。SSH、ルーターのポート開放、VPNサービスへの各端末ログインは通常の参加手順に含めない。

## 配布物

- macOS用の1つのREIアプリに、REIの実行環境と仕事の実行に必要なOpenClawを同梱する。外部AIモデルの認証は初回起動時に各端末で行う。
- REIのアプリ本体・利用者データ・OpenClawの設定を別の場所に置き、アプリ更新で既存データを上書きしない。
- 同梱するソフトウェアの版とライセンス表示を配布物に含める。Apple SiliconとIntel Macの動作をそれぞれ確認する。
- 既存のZIP版から移行する場合、データ、端末トークン、仕事の履歴を明示的に引き継ぎ、失敗時に旧環境を残す。

## 通信

- 中心MacのHubは既定どおりローカルでのみ待ち受ける。インターネットへHubのHTTPポートを直接公開しない。
- 同一ネットワーク接続は端末発見、接続先の真正性確認、暗号化、再接続をREI内部で行う。発見に失敗しても接続コードで参加できるようにする。
- 遠隔接続はREI内蔵クライアントから外向きに中継サービスへ接続する。中継事業者が仕事の内容、認証トークン、結果を読めないよう、端末間で暗号化・認証する。中継先には仕事データを永続保存しない。
- 接続コードは短時間・一回限りとする。参加後は端末ごとの資格情報へ切り替え、中心Macから個別に失効させられるようにする。
- 中継障害や無料枠の超過を検出したら、仕事を成功扱いにせず接続待ちを表示する。実行済みか不明な仕事は自動再実行しない。

## 中継サービスの選定

現時点ではCloudflare Workers + Durable Objectsの無料枠が候補。Cloudflareの公式料金表はDurable Objectsの無料枠を示すが、利用量上限があり、継続的な無償提供や業務運用の可用性は保証されない。`workers.dev` は公式に業務上重要な本番用途には推奨されていないため、本番利用では会社が管理するドメインも検討する。Quick Tunnelは公式に開発・テスト用とされるため本番接続に使用しない。中継のデプロイ先、安定したドメイン、上限到達時の扱いは導入前に確定する。

参考: [Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)、[WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)、[Workersのドメイン](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)、[Quick Tunnelの用途](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

## 実装と検証の順序

1. 既存の参加コード、端末別トークン、履歴を維持したまま通信層を分離する。
2. 同じネットワークの2台をREIだけで接続し、コードの期限切れ・再使用・端末解除を検証する。
3. 暗号化中継を実装し、会社と自宅のような別ネットワークの2台で接続・切断・再接続・長い結果の返送を検証する。
4. Node.jsとOpenClawを同梱したmacOSアプリを作り、新規Macで他のツールを入れずに初回登録から仕事実行まで検証する。
5. 既存ZIP版からの移行と更新・復旧を検証した後、完成版の案内を一本化する。

現行のTailscale + Node.js + OpenClawを各自で導入する方式は、この受け入れ条件を満たさない暫定の開発用手順である。
