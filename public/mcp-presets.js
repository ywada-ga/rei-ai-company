// HTTPS MCP endpoints and prerequisites are checked against each provider's official documentation.
export const MCP_PRESETS = [
  {
    id:'notion',title:'Notion',label:'Notion',url:'https://mcp.notion.com/mcp',auth:'oauth',
    note:'Notionワークスペースへのアクセスを、対象PCで認証します。',
    docs:'https://developers.notion.com/guides/mcp/get-started-with-mcp'
  },
  {
    id:'linear',title:'Linear',label:'Linear',url:'https://mcp.linear.app/mcp',auth:'oauth',
    note:'課題やプロジェクトの閲覧・更新に対応します。対象PCでLinearにログインします。',
    docs:'https://linear.app/docs/mcp'
  },
  {
    id:'linear-readonly',title:'Linear（閲覧のみ）',label:'Linear（閲覧のみ）',url:'https://mcp.linear.app/mcp/readonly',auth:'oauth',
    note:'Linearの読み取り専用エンドポイントです。書き込みツールは公開されません。',
    docs:'https://linear.app/docs/mcp'
  },
  {
    id:'atlassian',title:'Jira・Confluence（Atlassian）',label:'Jira・Confluence',url:'https://mcp.atlassian.com/v2/mcp',auth:'oauth',
    note:'Atlassian Cloud向けです。組織の管理者によるMCP利用許可が必要な場合があります。',
    docs:'https://atlassian.github.io/atlassian-mcp-server/'
  },
  {
    id:'calendar',title:'Googleカレンダー（開発者向けプレビュー）',label:'Googleカレンダー',url:'https://calendarmcp.googleapis.com/mcp/v1',auth:'oauth',
    note:'Google Workspace Developer Previewへの参加、CloudプロジェクトとOAuth設定が必要です。',
    docs:'https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server'
  },
  {
    id:'gmail',title:'Gmail（開発者向けプレビュー）',label:'Gmail',url:'https://gmailmcp.googleapis.com/mcp/v1',auth:'oauth',
    note:'Google Workspace Developer Previewへの参加、CloudプロジェクトとOAuth設定が必要です。',
    docs:'https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server'
  },
  {
    id:'drive',title:'Googleドライブ（開発者向けプレビュー）',label:'Googleドライブ',url:'https://drivemcp.googleapis.com/mcp/v1',auth:'oauth',
    note:'Google Workspace Developer Previewへの参加、CloudプロジェクトとOAuth設定が必要です。',
    docs:'https://developers.google.com/workspace/drive/api/guides/configure-mcp-server'
  },
  {
    id:'custom',title:'その他のHTTPS MCP',label:'',url:'',auth:'oauth',
    note:'提供元が公開するStreamable HTTPのURLを入力してください。stdio方式やAPIキー方式は現在対象外です。',
    docs:''
  }
];
