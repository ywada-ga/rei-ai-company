# 日本向け業務MCPの調査とREI対応状況

調査日: 2026-09-25。対象は、日本の業務で利用されるサービスのうち、提供元が公開し、OpenClawから使える可能性があるMCPです。「すべてのMCP」の完全な一覧ではありません。サービスの公開状況や認証条件は変わるため、REIの画面から各提供元の手順を確認してください。

## チェックボックスから登録できる公式リモートMCP

| サービス | 認証と前提 | 提供元の手順 |
|---|---|---|
| freee | OAuth。freeeはAgent Skillsの導入も必須と案内 | [freeeヘルプ](https://support.freee.co.jp/hc/ja/articles/56390747520537-freee-mcp-%E3%83%AA%E3%83%A2%E3%83%BC%E3%83%88%E7%89%88-%E3%82%92%E8%A8%AD%E5%AE%9A%E3%81%97%E3%81%A6%E5%88%A9%E7%94%A8%E3%81%99%E3%82%8B) |
| マネーフォワード クラウド会計 | OAuth。アプリポータル側の連携権限が必要 | [公式サポート](https://biz.moneyforward.com/support/account/guide/others/ot10.html) |
| マネーフォワード クラウド事業者情報 | OAuth。事業者番号・事業者名の参照用 | [開発者サイト](https://developers.biz.moneyforward.com/docs/mcp-common/tenant-info-mcp-server/) |
| Misoca | OAuth。有償プランが必要 | [弥生サポート](https://support.yayoi-kk.co.jp/subcontents.html?page_id=31438) |
| kintone公式ドキュメント検索 | 認証なし。API資料の検索用で、顧客データは操作しない | [サイボウズ開発者向け説明](https://cybozu.dev/ja/kintone/ai/kintone-documentation-mcp-overview/) |
| SUZURI | OAuth。商品検索・作成などに対応 | [SUZURI API](https://suzuri.jp/developer/documentation/mcp_server) |
| Meeting.ai | OAuth。アカウントとワークスペースが必要。OpenClaw向け手順あり | [Meeting.ai公式手順](https://meeting.ai/ja/docs/developers/connect-meeting-ai) |
| Notion | OAuth | [Notion開発者向け説明](https://developers.notion.com/guides/mcp/get-started-with-mcp) |
| Linear／Linear閲覧のみ | OAuth。閲覧のみは別エンドポイント | [Linear公式手順](https://linear.app/docs/mcp) |
| Jira・Confluence | OAuth。Atlassian Cloudでの利用権限が必要 | [Atlassian公式MCP](https://atlassian.github.io/atlassian-mcp-server/) |
| Googleカレンダー／Gmail／ドライブ／ドキュメント／スプレッドシート／スライド／Chat／連絡先 | OAuth。Google Workspace Developer Preview、Cloudプロジェクト等の準備が必要 | [Google Workspace公式設定手順](https://developers.google.com/workspace/guides/configure-mcp-servers) |
| Google Workspace横断検索 | OAuth。Developer Preview、検索対象の各APIとOAuth設定が必要 | [Google公式手順](https://developers.google.com/workspace/guides/universal-search-mcp) |

REIはサーバー定義を選んだPCのOpenClawへ登録します。OAuthが必要なサービスはそのPCで `openclaw mcp login <表示された名前>` を実行します。REIの「登録済み」は外部サービスとの通信成功を意味しません。アカウント認証とツール実行は各サービスで確認する必要があります。REIがパスワードやOAuthトークンを収集することはありません。

## 調査したがチェックボックスで登録できないもの

| サービス | 理由と現在の扱い | 提供元の説明 |
|---|---|---|
| kintone顧客データ操作 | 公式版はローカル起動型。REIの現在の自動配信はHTTPSリモートMCPに対応 | [kintone MCP](https://cybozu.dev/ja/kintone/ai/kintone-mcp-server/) |
| Garoon | 公式版はローカル起動型 | [Garoon MCP](https://cybozu.dev/ja/garoon/ai/garoon-mcp-server/) |
| Backlog | ヌーラボ公開のMCPは各PCで起動するソフト。導入・資格情報の扱いが必要 | [Backlogヘルプ](https://help-center.backlog.com/MCP%E3%82%B5%E3%83%BC%E3%83%90%E3%83%BC-6a1d4d7e9d0d1f0251da1ba7) |
| esa | 公式リモートMCPはベータ版で、現在の案内にOpenClawが対応クライアントとして掲載されていない | [esa公式ヘルプ](https://docs.esa.io/posts/584) |
| カラーミーショップ AIコネクター | ショップごとのMCP URLをアプリ設定画面から取得する方式。取得後はREIの個別URL登録で試せる | [公式アプリストア](https://app.shop-pro.jp/apps/956/) |
| Chatwork | REIにはMCPとは別に、Chatwork APIによる人への依頼・返信機能がある | [README](README.md) |
| Slack | 公式リモートMCPは固定の登録済みクライアントアプリを要求し、動的クライアント登録には非対応 | [Slack開発者向け説明](https://docs.slack.dev/ai/slack-mcp-server/) |
| GitHub | 公式リモートMCPは、OAuth利用時にMCPホスト側のアプリ登録が必要 | [GitHub公式MCP](https://github.com/github/github-mcp-server) |
| Figma | 現在はFigmaが列挙する承認済みクライアントに限定 | [Figma公式手順](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) |
| Microsoft 365 Work IQ | テナント管理者によるアプリ登録・権限同意などが必要 | [Microsoft公式手順](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/quickstart/foundry) |

任意のStreamable HTTP対応MCPは「URLを指定して個別に追加する」で登録できます。APIキーをHTTPヘッダーに設定する方式、各PCで起動するstdio方式は、現状のREIでは自動配信できません。これらを無理にワンクリック扱いにせず、認証情報の保存方法と端末ごとの実行管理を整えた後に対応します。
