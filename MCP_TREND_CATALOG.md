# 話題のMCP調査とREI対応状況

調査日: 2026-09-25。Web検索とXの投稿で候補を拾い、接続先と条件は提供元の公開資料で確認しました。「話題」は選定のきっかけであり、人気順位や利用者数を意味しません。MCPは多数あり、全件収録を保証するものではありません。REIの一括登録対象は、現状のConnectorからHTTPSのStreamable HTTPで配信できる公式サーバーです。

Xでは[X公式MCPを紹介する投稿](https://x.com/MakeAI_CEO/status/2041363825631658448)や[日本語の実利用報告](https://x.com/takabin_leadeck/status/2041508474581106812)を確認しました。投稿の説明だけで接続方式を決めず、[X側の公式手順](https://github.com/xdevplatform/docs/blob/main/tools/mcp.mdx)で資格情報の要件を照合しています。

## チェックボックスへ追加した候補

| サービス | 接続と条件 | 提供元の資料 |
|---|---|---|
| Context7 | OAuth専用URL `/mcp/oauth` を使用。技術資料検索 | [Context7公式](https://context7.com/docs/resources/all-clients) |
| Supabase | OAuth。可能ならプロジェクト単位にアクセスを絞る | [Supabase公式](https://supabase.com/docs/guides/ai-tools/mcp) |
| Sentry | OAuth。組織・プロジェクト単位のURLにも変更可能 | [Sentry公式](https://mcp.sentry.dev/) |
| Cloudflare API | OAuth。DNS・Workersなど広範囲の操作に対応 | [Cloudflare公式](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) |
| Cloudflareドキュメント | 公式技術資料検索 | [Cloudflare公式](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) |
| Upstash | OAuth。認証時に閲覧専用の権限を選べる | [Upstash公式](https://upstash.com/docs/agent-resources/mcp) |
| Exa | 匿名で接続可能。匿名利用には回数制限がある | [Exa公式リポジトリ](https://github.com/exa-labs/exa-mcp-server) |
| Firecrawl | OAuth専用URL `/v2/mcp-oauth` を使用 | [Firecrawl公式ドキュメント](https://github.com/firecrawl/firecrawl-docs/blob/main/mcp-server.mdx) |
| Stripe | OAuth。決済情報の読み書きに対応。アカウントと権限を絞る | [Stripe公式](https://docs.stripe.com/mcp) |

チェックボックスで行うのはMCPサーバーの登録です。OAuth認証は対象PCで別途行い、実際に使えるかはサービスごとにツール実行まで確認してください。StripeやCloudflare APIなどは変更操作を公開するため、外部サービス側の同意画面で権限を確認してください。

## 話題だが現時点で自動登録しない候補

| サービス | 現状の条件 | 提供元の資料 |
|---|---|---|
| X公式MCP | X上で話題。公式HTTP接続にはアプリ用Bearerトークン、CLI経由はPCごとの起動と資格情報が必要。REIは現在どちらの方式も一括配信しない | [X公式MCP接続手順](https://github.com/xdevplatform/docs/blob/main/tools/mcp.mdx) |
| HubSpot | 公式リモートMCPにはMCP認証アプリの登録、クライアントID・シークレット設定が必要 | [HubSpot公式](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server) |
| Vercel | リモートMCPの接続クライアントは審査済みリストに限定され、現時点でOpenClawは掲載されていない | [Vercel公式](https://vercel.com/docs/agent-resources/vercel-mcp) |
| Figma | 公式リモートMCPは承認済みクライアント向け。独自クライアントは申請が必要 | [Figma公式](https://www.figma.com/mcp-catalog/) |
| Canva | 日常利用向けAI Connectorは対応AIアシスタントから接続する案内 | [Canva公式](https://www.canva.com/help/mcp-agent-setup/) |
| Perplexity API | 公式リモートMCPはAPIキーのHTTPヘッダーが必要 | [Perplexity公式](https://github.com/perplexityai/modelcontextprotocol) |

任意のHTTPS MCP URLはREI画面の「URLを指定して個別に追加する」から登録できます。ただし追加のヘッダーやクライアント登録が必要なサービスは、URLだけで動作しません。外部アカウントに勝手に接続したり、資格情報をREIに保存したりしません。
