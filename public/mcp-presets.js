// HTTPS MCP endpoints and prerequisites are checked against each provider's official documentation.
export const MCP_PRESETS = [
  {
    id:'freee',category:'国内の業務サービス',title:'freee',label:'freee',url:'https://mcp.freee.co.jp/mcp',auth:'oauth',
    note:'freeeのログインが必要です。公式案内ではAgent Skillsの導入も必須とされています。',
    docs:'https://support.freee.co.jp/hc/ja/articles/56390747520537-freee-mcp-%E3%83%AA%E3%83%A2%E3%83%BC%E3%83%88%E7%89%88-%E3%82%92%E8%A8%AD%E5%AE%9A%E3%81%97%E3%81%A6%E5%88%A9%E7%94%A8%E3%81%99%E3%82%8B'
  },
  {
    id:'moneyforward-accounting',category:'国内の業務サービス',title:'マネーフォワード クラウド会計',label:'マネーフォワード クラウド会計',url:'https://beta.mcp.developers.biz.moneyforward.com/mcp/ca/v3',auth:'oauth',
    note:'クラウド会計・確定申告向け。アプリポータルで連携権限の設定が必要です。',
    docs:'https://biz.moneyforward.com/support/account/guide/others/ot10.html'
  },
  {
    id:'moneyforward-tenant',category:'国内の業務サービス',title:'マネーフォワード クラウド事業者情報',label:'マネーフォワード 事業者情報',url:'https://beta.mcp.developers.biz.moneyforward.com/mcp/admin/v2',auth:'oauth',
    note:'事業者番号・事業者名の参照用です。OAuth認証で接続します。',
    docs:'https://developers.biz.moneyforward.com/docs/mcp-common/tenant-info-mcp-server/'
  },
  {
    id:'misoca',category:'国内の業務サービス',title:'Misoca（請求書）',label:'Misoca',url:'https://mcp.misoca.jp/mcp',auth:'oauth',
    note:'Misocaの有償プラン契約者向けです。OAuthでアカウントを認証します。',
    docs:'https://support.yayoi-kk.co.jp/subcontents.html?page_id=31438'
  },
  {
    id:'kintone-docs',category:'国内の業務サービス',title:'kintone公式ドキュメント検索',label:'kintone公式ドキュメント',url:'https://mcp.cybozu.dev/mcp',auth:'none',
    note:'kintoneのAPI資料を検索します。自社のkintoneデータ操作用MCPではありません。',
    docs:'https://cybozu.dev/ja/kintone/ai/kintone-documentation-mcp-overview/'
  },
  {
    id:'suzuri',category:'国内の業務サービス',title:'SUZURI',label:'SUZURI',url:'https://mcp.suzuri.jp/mcp',auth:'oauth',
    note:'商品検索・作成などに対応します。初回はSUZURIでOAuth認証が必要です。',
    docs:'https://suzuri.jp/developer/documentation/mcp_server'
  },
  {
    id:'meeting-ai',category:'会議・議事録',title:'Meeting.ai',label:'Meeting.ai',url:'https://mcp.meeting.ai/mcp',auth:'oauth',
    note:'会議・ノート・文字起こしなどに対応。Meeting.aiアカウントとワークスペースが必要です。',
    docs:'https://meeting.ai/ja/docs/developers/connect-meeting-ai'
  },
  {
    id:'notion',category:'文書・プロジェクト',title:'Notion',label:'Notion',url:'https://mcp.notion.com/mcp',auth:'oauth',
    note:'Notionワークスペースへのアクセスを、対象PCで認証します。',
    docs:'https://developers.notion.com/guides/mcp/get-started-with-mcp'
  },
  {
    id:'linear',category:'文書・プロジェクト',title:'Linear',label:'Linear',url:'https://mcp.linear.app/mcp',auth:'oauth',
    note:'課題やプロジェクトの閲覧・更新に対応します。対象PCでLinearにログインします。',
    docs:'https://linear.app/docs/mcp'
  },
  {
    id:'linear-readonly',category:'文書・プロジェクト',title:'Linear（閲覧のみ）',label:'Linear（閲覧のみ）',url:'https://mcp.linear.app/mcp/readonly',auth:'oauth',
    note:'Linearの読み取り専用エンドポイントです。書き込みツールは公開されません。',
    docs:'https://linear.app/docs/mcp'
  },
  {
    id:'atlassian',category:'文書・プロジェクト',title:'Jira・Confluence（Atlassian）',label:'Jira・Confluence',url:'https://mcp.atlassian.com/v2/mcp',auth:'oauth',
    note:'Atlassian Cloud向けです。組織の管理者によるMCP利用許可が必要な場合があります。',
    docs:'https://atlassian.github.io/atlassian-mcp-server/'
  },
  {
    id:'calendar',category:'Google Workspace（開発者向け）',title:'Googleカレンダー',label:'Googleカレンダー',url:'https://calendarmcp.googleapis.com/mcp/v1',auth:'oauth',
    note:'Google Workspace Developer Previewへの参加、CloudプロジェクトとOAuth設定が必要です。',
    docs:'https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server'
  },
  {
    id:'gmail',category:'Google Workspace（開発者向け）',title:'Gmail',label:'Gmail',url:'https://gmailmcp.googleapis.com/mcp/v1',auth:'oauth',
    note:'Google Workspace Developer Previewへの参加、CloudプロジェクトとOAuth設定が必要です。',
    docs:'https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server'
  },
  {
    id:'drive',category:'Google Workspace（開発者向け）',title:'Googleドライブ',label:'Googleドライブ',url:'https://drivemcp.googleapis.com/mcp/v1',auth:'oauth',
    note:'Google Workspace Developer Previewへの参加、CloudプロジェクトとOAuth設定が必要です。',
    docs:'https://developers.google.com/workspace/drive/api/guides/configure-mcp-server'
  },
  {
    id:'google-docs',category:'Google Workspace（開発者向け）',title:'Googleドキュメント',label:'Googleドキュメント',url:'https://docsmcp.googleapis.com/mcp/v1',auth:'oauth',
    note:'Google Workspace Developer Previewへの参加、CloudプロジェクトとOAuth設定が必要です。',
    docs:'https://developers.google.com/workspace/guides/configure-mcp-servers'
  },
  {
    id:'google-sheets',category:'Google Workspace（開発者向け）',title:'Googleスプレッドシート',label:'Googleスプレッドシート',url:'https://sheetsmcp.googleapis.com/mcp/v1',auth:'oauth',
    note:'Google Workspace Developer Previewへの参加、CloudプロジェクトとOAuth設定が必要です。',
    docs:'https://developers.google.com/workspace/guides/configure-mcp-servers'
  },
  {
    id:'google-slides',category:'Google Workspace（開発者向け）',title:'Googleスライド',label:'Googleスライド',url:'https://slidesmcp.googleapis.com/mcp/v1',auth:'oauth',
    note:'Google Workspace Developer Previewへの参加、CloudプロジェクトとOAuth設定が必要です。',
    docs:'https://developers.google.com/workspace/guides/configure-mcp-servers'
  },
  {
    id:'google-chat',category:'Google Workspace（開発者向け）',title:'Google Chat',label:'Google Chat',url:'https://chatmcp.googleapis.com/mcp/v1',auth:'oauth',
    note:'Google Workspace Developer Previewへの参加、CloudプロジェクトとOAuth設定が必要です。',
    docs:'https://developers.google.com/workspace/guides/configure-mcp-servers'
  },
  {
    id:'context7',category:'開発・技術資料',title:'Context7',label:'Context7',url:'https://mcp.context7.com/mcp/oauth',auth:'oauth',
    note:'ライブラリの最新ドキュメントを検索します。OAuth専用URLを使用します。',
    docs:'https://context7.com/docs/resources/all-clients'
  },
  {
    id:'supabase',category:'開発・技術資料',title:'Supabase',label:'Supabase',url:'https://mcp.supabase.com/mcp',auth:'oauth',
    note:'データベースやプロジェクト管理に対応します。接続後は対象プロジェクトと権限を確認してください。',
    docs:'https://supabase.com/docs/guides/ai-tools/mcp'
  },
  {
    id:'sentry',category:'開発・技術資料',title:'Sentry',label:'Sentry',url:'https://mcp.sentry.dev/mcp',auth:'oauth',
    note:'エラーやトレースの調査に対応します。可能なら組織・プロジェクト単位のURLに絞ってください。',
    docs:'https://mcp.sentry.dev/'
  },
  {
    id:'cloudflare-api',category:'開発・技術資料',title:'Cloudflare API',label:'Cloudflare API',url:'https://mcp.cloudflare.com/mcp',auth:'oauth',
    note:'DNSやWorkersなど広い操作に対応します。OAuth同意画面で必要な権限だけ選択してください。',
    docs:'https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/'
  },
  {
    id:'cloudflare-docs',category:'開発・技術資料',title:'Cloudflareドキュメント',label:'Cloudflareドキュメント',url:'https://docs.mcp.cloudflare.com/mcp',auth:'oauth',
    note:'Cloudflareの公式技術資料を検索します。',
    docs:'https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/'
  },
  {
    id:'upstash',category:'開発・技術資料',title:'Upstash',label:'Upstash',url:'https://mcp.upstash.com/mcp',auth:'oauth',
    note:'RedisなどのUpstashリソースを扱います。認証時に閲覧専用の権限も選べます。',
    docs:'https://upstash.com/docs/agent-resources/mcp'
  },
  {
    id:'exa',category:'調査・Web情報',title:'Exa Web検索',label:'Exa',url:'https://mcp.exa.ai/mcp',auth:'none',
    note:'Web検索・クロール用。匿名接続では利用回数に制限があります。',
    docs:'https://github.com/exa-labs/exa-mcp-server'
  },
  {
    id:'firecrawl',category:'調査・Web情報',title:'Firecrawl',label:'Firecrawl',url:'https://mcp.firecrawl.dev/v2/mcp-oauth',auth:'oauth',
    note:'Webページの取得・検索などに対応します。Firecrawlのブラウザ認証を使います。',
    docs:'https://github.com/firecrawl/firecrawl-docs/blob/main/mcp-server.mdx'
  },
  {
    id:'stripe',category:'決済・機密データ',title:'Stripe',label:'Stripe',url:'https://mcp.stripe.com',auth:'oauth',
    note:'決済情報の閲覧や変更操作が可能です。Stripe側で接続先アカウントと権限を慎重に選んでください。',
    docs:'https://docs.stripe.com/mcp'
  },
  {
    id:'custom',category:'個別設定',title:'その他のHTTPS MCP',label:'',url:'',auth:'oauth',
    note:'提供元が公開するStreamable HTTPのURLを入力してください。stdio方式やAPIキー方式は現在対象外です。',
    docs:''
  }
];
