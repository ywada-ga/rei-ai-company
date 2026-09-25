import { MCP_PRESETS } from './mcp-presets.js';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const formatTime = value => value ? new Intl.DateTimeFormat('ja-JP', { timeZone:'Asia/Tokyo', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value)) : '—';
const state = { data:null, view:'core', selectedDepartment:null, selectedTask:null, report:null, pendingReplyTaskId:null, voiceOn:false, mcpIntegrations:[], mcpSearch:'' };
const labels = { queued:'待機', ready:'待機', planning:'計画中', approval_pending:'承認待ち', running:'実行中', completed:'完了', failed:'失敗', interrupted:'中断', needs_review:'要確認', waiting_human:'人待ち', waiting_reply:'返答待ち' };
const icons = ['◉','✧','⬡','↗','◇','♧'];

async function request(url, options) {
  const route=url.replace(/^\/api\//,'');
  const response = await fetch(`/api?route=${encodeURIComponent(route)}`, options);
  const json = await response.json();
  if (response.status === 401 && !route.startsWith('auth/')) showAuth();
  if (!response.ok) throw new Error(json.error || '通信に失敗しました');
  return json;
}
function feedback(message, isError=false) {
  $('command-feedback').textContent = message;
  $('command-feedback').classList.toggle('error', isError);
}
function tick() {
  const now = new Date();
  $('clock').textContent = new Intl.DateTimeFormat('ja-JP', { timeZone:'Asia/Tokyo', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(now);
  $('date').textContent = new Intl.DateTimeFormat('ja-JP', { timeZone:'Asia/Tokyo', month:'2-digit', day:'2-digit', weekday:'short' }).format(now);
}
function setView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('hidden', element.id !== `${view}-view`));
  document.querySelectorAll('.rail-btn').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  const copy = {
    core:['レイ','COMMAND CENTER','レイに目的を伝える。AI会社が仕事を動かす。'],
    missions:['ミッション','MISSION CONTROL','指示から実行、結果までを追跡します。'],
    briefing:['稼働報告','DAILY INTELLIGENCE','今日の実行記録を、接続済みのユニットから集約します。']
  }[view];
  $('view-title').innerHTML = `${copy[0]} <span>${copy[1]}</span>`;
  $('view-subtitle').textContent = copy[2];
  render();
  if (view === 'briefing' && !state.report) loadReport();
}
async function refresh() {
  try { state.data = await request('/api/bootstrap'); render(); }
  catch (error) { if(error.message!=='ログインしてください')feedback(error.message, true); $('system-status').textContent = 'OFFLINE'; }
}
function render() {
  if (!state.data) return;
  const { departments, workers, tasks, gateway } = state.data;
  const live = gateway.reachable;
  $('system-status').textContent = live ? 'ONLINE' : 'OFFLINE';
  $('system-status').classList.toggle('offline', !live);
  $('stage-status').textContent = live ? 'GATEWAY LINK ESTABLISHED' : 'GATEWAY DISCONNECTED';
  $('core-state').textContent = live ? 'CONNECTED / READY' : 'DISCONNECTED';
  $('agent-count').textContent = String(workers.filter(w=>w.connected).length).padStart(2,'0');
  $('running-count').textContent = String(tasks.filter(task => ['running','planning'].includes(task.status)).length).padStart(2,'0');
  $('network-count').textContent = `${String(workers.filter(w=>w.connected).length).padStart(2,'0')} / ${String(workers.length).padStart(2,'0')}`;
  $('department-orbit').innerHTML = departments.map((department,index) => {
    const active = tasks.filter(task => task.department === department.id && task.status === 'running').length;
    return `<button class="orbit-node node-${index} ${state.selectedDepartment === department.id ? 'selected' : ''}" data-department="${escapeHtml(department.id)}"><span class="node-icon">${icons[index]}</span><span class="node-copy"><small>SECTOR 0${index+1}</small><strong>${escapeHtml(department.name)}</strong><em>${active ? `${active} ACTIVE` : 'STANDBY'}</em></span></button>`;
  }).join('');
  $('mission-feed').innerHTML = tasks.length ? tasks.slice(0,3).map(task => `<div class="exchange"><div class="exchange-user"><small>YOU / ${formatTime(task.createdAt)}</small><p>${escapeHtml(task.text)}</p></div><div class="exchange-rei"><small>REI / ${escapeHtml(labels[task.status] || task.status)}</small><p>${escapeHtml((task.result || task.error || '承知しました。実行しています…').slice(0,420))}</p></div><button data-task="${escapeHtml(task.id)}">詳細を見る ↗</button></div>`).join('') : `<div class="panel-empty"><span>○</span><strong>おかえりなさい</strong><small>レイは次の指示をお待ちしています。</small></div>`;
  $('system-signals').innerHTML = `<div class="signal-row"><span>REI HUB</span><b class="online">● ONLINE</b></div><div class="signal-row"><span>OPENCLAW端末</span><b class="${live ? 'online' : 'offline'}">${workers.filter(w=>w.connected).length} / ${workers.length} CONNECTED</b></div><div class="signal-row"><span>計画担当</span><b>${workers.some(w=>w.planner&&w.connected)?'READY':'WAITING'}</b></div><div class="signal-row"><span>CHATWORK</span><b>設定画面で確認</b></div><div class="signal-foot">端末の登録と状態は「端末・設定」で確認できます</div>`;
  $('unit-list').innerHTML = workers.map(worker => {
    const connected = worker.connected;
    return `<div class="unit-row"><span class="unit-glyph ${connected ? 'online' : ''}">${worker.kind === '人' ? '♧' : worker.kind === '端末' ? '▣' : '✳'}</span><span><strong>${escapeHtml(worker.name)}</strong><small>${escapeHtml(worker.machine)}</small></span><i class="unit-led ${connected ? 'online' : ''}"></i></div>`;
  }).join('');
  renderFocus();
  renderMissions();
  renderBriefing();
  const reply = tasks.find(task => task.id === state.pendingReplyTaskId);
  if (reply && ['completed','failed','interrupted','needs_review'].includes(reply.status)) {
    state.pendingReplyTaskId = null;
    feedback(reply.status === 'completed' ? 'レイから返答が届きました' : 'レイから確認が必要な報告があります', reply.status !== 'completed');
    if (state.voiceOn) speak(reply.result || reply.error || '処理を完了できませんでした。');
  }
  document.querySelectorAll('[data-department]').forEach(element => element.onclick = () => { state.selectedDepartment = element.dataset.department; render(); });
  document.querySelectorAll('[data-task]').forEach(element => element.onclick = () => { state.selectedTask = element.dataset.task; setView('missions'); });
  document.querySelectorAll('[data-go]').forEach(element => element.onclick = () => setView(element.dataset.go));
}
function renderFocus() {
  const department = state.data.departments.find(item => item.id === state.selectedDepartment);
  if (!department) {
    $('focus-content').innerHTML = `<div class="focus-idle"><span>◇</span><strong>部署を選択</strong><p>中央のネットワークから部署を選ぶと、担当領域と仕事を確認できます。</p></div>`;
    return;
  }
  const tasks = state.data.tasks.filter(item => item.department === department.id);
  $('focus-content').innerHTML = `<div class="focus-active"><span>SELECTED SECTOR</span><h3>${escapeHtml(department.name)}</h3><p>${escapeHtml(department.detail)}</p><div><small>ASSIGNED MISSIONS</small><b>${String(tasks.length).padStart(2,'0')}</b></div><button id="focus-missions">仕事一覧を見る ↗</button></div>`;
  $('focus-missions').onclick = () => setView('missions');
}
function renderMissions() {
  const tasks = state.data.tasks;
  $('mission-total').textContent = `${String(tasks.length).padStart(2,'0')} MISSIONS`;
  $('mission-list').innerHTML = tasks.length ? tasks.map((task,index) => `<button class="mission-row ${state.selectedTask === task.id ? 'selected' : ''}" data-task="${escapeHtml(task.id)}"><span class="mission-index">${String(index+1).padStart(2,'0')}</span><span><strong>${escapeHtml(task.text)}</strong><small>${formatTime(task.createdAt)} · REI / HUB</small></span><em class="status ${escapeHtml(task.status)}">${escapeHtml(labels[task.status] || task.status)}</em></button>`).join('') : `<div class="panel-empty tall"><span>◇</span><strong>ミッションはありません</strong><small>下の入力欄から最初の仕事を依頼してください。</small></div>`;
  const chosen = tasks.find(item => item.id === state.selectedTask) || tasks[0];
  $('mission-detail').innerHTML = chosen ? `<div class="detail-header"><span>MISSION FILE / ${escapeHtml(chosen.id.slice(0,8).toUpperCase())}</span><em class="status ${escapeHtml(chosen.status)}">${escapeHtml(labels[chosen.status] || chosen.status)}</em></div><h3>${escapeHtml(chosen.text)}</h3><div class="detail-facts"><div><span>担当</span><b>OpenClaw · main</b></div><div><span>開始</span><b>${formatTime(chosen.startedAt)}</b></div><div><span>完了</span><b>${formatTime(chosen.finishedAt)}</b></div></div><div class="detail-result"><span>RESPONSE / RESULT</span><p>${escapeHtml(chosen.result || chosen.error || '実行結果を待っています。')}</p></div>` : `<div class="panel-empty tall"><span>⌕</span><strong>詳細を表示する仕事がありません</strong></div>`;
}
async function loadReport() {
  $('briefing-content').innerHTML = '<div class="glass-panel loading">実行記録を照合しています...</div>';
  try { state.report = await request('/api/report/today'); renderBriefing(); }
  catch (error) { $('briefing-content').innerHTML = `<div class="glass-panel loading">${escapeHtml(error.message)}</div>`; }
}
function renderBriefing() {
  if (!state.report) return;
  const report = state.report;
  const units=state.data?.workers||[];
  const connected=units.filter(unit=>unit.connected).length;
  const rows=units.map(unit=>`<li>${escapeHtml(unit.name)} <b>${unit.connected?'接続中':'未接続'}</b></li>`).join('');
  $('briefing-content').innerHTML = `<div class="brief-grid"><div class="glass-panel briefing-lead"><span>BRIEFING / ${escapeHtml(report.day)}</span><h3>本日の稼働状況</h3><p>REIに登録された端末は <b>${units.length}台</b>、現在接続中は <b>${connected}台</b>。本日の依頼は <b>${report.total}件</b>です。</p><div class="brief-stats"><div><small>COMPLETED</small><strong>${report.completed}</strong><span>完了</span></div><div><small>IN PROGRESS</small><strong>${report.running}</strong><span>進行中</span></div><div><small>NEEDS ATTENTION</small><strong>${report.failed+report.interrupted}</strong><span>要確認</span></div></div></div><div class="glass-panel briefing-scope"><span>DATA SCOPE</span><h3>集計対象</h3><p>このREI Hubで記録した仕事だけを集計しています。端末の他用途の活動は含みません。</p><ul>${rows||'<li>登録端末なし</li>'}</ul></div></div><div class="glass-panel briefing-tasks"><div class="panel-heading"><span>RECORDED MISSIONS</span><span>${report.total} ENTRIES</span></div>${report.tasks.length?report.tasks.map(task=>`<div class="brief-task"><span class="status ${escapeHtml(task.status)}">${escapeHtml(labels[task.status]||task.status)}</span><div><strong>${escapeHtml(task.text)}</strong><small>${escapeHtml(task.summary)}</small></div><span>${formatTime(task.createdAt)}</span></div>`).join(''):'<div class="panel-empty"><strong>今日の仕事はまだありません</strong></div>'}</div>`;
}
document.querySelectorAll('.rail-btn').forEach(button => button.onclick = () => setView(button.dataset.view));
$('refresh').onclick = refresh;
$('report-refresh').onclick = loadReport;
$('core-button').onclick = () => $('command-input').focus();
$('command-form').onsubmit = async event => {
  event.preventDefault();
  const input = $('command-input');
  const text = input.value.trim();
  if (!text) return;
  const button = event.target.querySelector('[type="submit"]');
  button.disabled = true;
  feedback('レイに伝えています...');
  try {
    const result = await request('/api/command', { method:'POST', headers:{ 'Content-Type':'application/json', 'X-AI-Company':'1' }, body:JSON.stringify({ text, department:state.selectedDepartment || 'operations' }) });
    input.value = '';
    await refresh();
    if (result.kind === 'report') { state.report = result.report; setView('briefing'); feedback('DAILY BRIEFING READY'); }
    else { state.selectedTask = result.task.id; state.pendingReplyTaskId = result.task.id; setView('core'); feedback('レイが仕事を進めています'); }
  } catch (error) { feedback(error.message, true); }
  finally { button.disabled = false; }
};
function speak(text) {
  if (!('speechSynthesis' in window)) return feedback('このブラウザでは音声応答を利用できません', true);
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(String(text).slice(0,800));
  utterance.lang = 'ja-JP';
  utterance.rate = 1.05;
  window.speechSynthesis.speak(utterance);
}
$('voice-output').onclick = () => {
  if (!('speechSynthesis' in window)) return feedback('このブラウザでは音声応答を利用できません', true);
  state.voiceOn = !state.voiceOn;
  $('voice-output').textContent = `音声応答 ${state.voiceOn ? 'ON' : 'OFF'}`;
  $('voice-output').setAttribute('aria-pressed', String(state.voiceOn));
  if (!state.voiceOn) window.speechSynthesis.cancel();
  feedback(state.voiceOn ? 'レイの音声応答を有効にしました' : '音声応答を停止しました');
};
$('voice-button').onclick = () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return feedback('このブラウザでは音声入力を利用できません', true);
  const recognizer = new Recognition();
  recognizer.lang = 'ja-JP';
  recognizer.interimResults = false;
  recognizer.onresult = event => { $('command-input').value = event.results[0][0].transcript; feedback('音声を入力しました。内容を確認して送信してください。'); };
  recognizer.onerror = event => feedback(`音声入力を完了できません: ${event.error}`, true);
  try { recognizer.start(); feedback('音声を聞いています...'); } catch { feedback('音声入力を開始できません', true); }
};
function showAuth() {
  const setupToken = new URLSearchParams(location.search).get('setup');
  $('auth-screen').classList.remove('hidden');
  $('auth-title').textContent = setupToken ? 'レイの初期登録' : 'レイにログイン';
  $('auth-help').textContent = setupToken ? '所有者のユーザー名とパスワードを設定してください。' : 'あなたの司令室に入ります。';
  $('auth-form').dataset.mode = setupToken ? 'setup' : 'login';
  $('auth-password').autocomplete = setupToken ? 'new-password' : 'current-password';
}
function renderMcpPresetGrid() {
  const deviceId=$('mcp-batch-device').value;
  const groups=[...new Set(MCP_PRESETS.filter(item=>item.url).map(item=>item.category))];
  $('mcp-preset-grid').innerHTML=`<div class="mcp-search-row"><input id="mcp-search" type="search" aria-label="MCPを検索" placeholder="サービス名や用途で探す"></div>`+groups.map(group=>`<div class="mcp-category"><h4>${escapeHtml(group)}</h4>${MCP_PRESETS.filter(item=>item.url&&item.category===group).map(item=>{
    const installed=state.mcpIntegrations.some(connected=>connected.device_id===deviceId&&connected.url===item.url);
    return `<label class="mcp-preset-option ${installed?'installed':''}"><input type="checkbox" name="mcp-preset" value="${escapeHtml(item.id)}" ${installed?'disabled':''}><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.note)}</small><a href="${escapeHtml(item.docs)}" target="_blank" rel="noopener noreferrer">公式手順 ↗</a></span><em>${installed?'追加済み':item.auth==='none'?'認証なし':'OAuth'}</em></label>`;
  }).join('')}</div>`).join('');
  const search=$('mcp-search');search.value=state.mcpSearch;
  const filter=()=>{state.mcpSearch=search.value.trim().toLocaleLowerCase();document.querySelectorAll('.mcp-category').forEach(category=>{let visible=0;category.querySelectorAll('.mcp-preset-option').forEach(option=>{const match=option.textContent.toLocaleLowerCase().includes(state.mcpSearch);option.classList.toggle('hidden',!match);if(match)visible++;});category.classList.toggle('hidden',visible===0);});};
  search.oninput=filter;filter();
}
async function refreshSettings() {
  if (!state.data?.user) return;
  $('signed-in-user').textContent = `${state.data.user.username} / ${state.data.user.role}`;
  const pending=state.data.tasks.filter(task=>task.status==='approval_pending');
  $('approval-management').innerHTML=pending.length?pending.map(task=>`<div class="setting-device"><span><b>${escapeHtml(task.text)}</b><small>依頼者の仕事</small></span><span><button data-approve="${escapeHtml(task.id)}" class="outline-button">承認</button><button data-reject="${escapeHtml(task.id)}" class="outline-button">却下</button></span></div>`).join(''):'<p>承認待ちはありません。</p>';
  document.querySelectorAll('[data-approve],[data-reject]').forEach(button=>button.onclick=async()=>{const route=button.dataset.approve?'approve':'reject',taskId=button.dataset.approve||button.dataset.reject;try{await request(`/api/tasks/${route}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId})});await refresh();await refreshSettings();}catch(e){$('settings-feedback').textContent=e.message;}});
  try {
    const [devices,chatwork,mcp] = await Promise.all([request('/api/devices'),request('/api/chatwork/status'),request('/api/mcp/list')]);
    $('device-management').innerHTML = devices.devices.length ? devices.devices.map(d=>`<div class="setting-device"><span><b>${escapeHtml(d.label)}</b><small>${d.online?'● 接続中':'○ 未接続'}${d.planner?' · REI計画担当':''}</small></span><button data-revoke="${escapeHtml(d.id)}" class="outline-button">解除</button></div>`).join('') : '<p>端末はまだ登録されていません。</p>';
    document.querySelectorAll('[data-revoke]').forEach(button=>button.onclick=async()=>{if(!confirm('この端末の接続を解除しますか？'))return;try{await request('/api/devices/revoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:button.dataset.revoke})});await refreshSettings();await refresh();}catch(e){$('settings-feedback').textContent=e.message;}});
    const selectedBatchDevice=$('mcp-batch-device').value;
    const deviceOptions=devices.devices.map(d=>`<option value="${escapeHtml(d.id)}">${escapeHtml(d.label)}${d.online?' · 接続中':' · 未接続'}</option>`).join('');
    $('mcp-device').innerHTML=deviceOptions;
    $('mcp-batch-device').innerHTML=deviceOptions;
    if(devices.devices.some(d=>d.id===selectedBatchDevice))$('mcp-batch-device').value=selectedBatchDevice;
    state.mcpIntegrations=mcp.integrations;
    renderMcpPresetGrid();
    $('mcp-management').innerHTML=mcp.integrations.length?`<button id="mcp-refresh" class="outline-button" type="button">接続状態を更新</button>${mcp.integrations.map(item=>{
      const status={configured:'OpenClawに登録済み',auth_required:'認証待ち',error:'設定エラー'}[item.status]||'端末への反映待ち';
      const pending=item.check_requested_at&&(!item.checked_at||item.checked_at<item.check_requested_at);
      const stale=pending&&Date.now()-item.check_requested_at>90000;
      const check=pending?'端末からの接続確認待ち':item.check_status==='success'?`接続成功 · ${item.tool_count}ツール`:item.check_status==='auth_required'?'接続確認: 認証待ち':item.check_status==='error'?`接続失敗: ${escapeHtml(item.check_error)}`:'';
      return `<div class="setting-device"><span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.device_label)} · ${status}</small>${check?`<small>${check}</small>`:''}${item.auth==='oauth'?`<small>対象PCで実行: <code>openclaw mcp login ${escapeHtml(item.name)}</code></small>`:''}</span>${state.data.user.role==='owner'?`<span><button data-mcp-check="${escapeHtml(item.name)}" class="outline-button" ${pending&&!stale?'disabled':''}>${stale?'再確認':'接続を確認'}</button><button data-mcp-remove="${escapeHtml(item.name)}" class="outline-button">解除</button></span>`:''}</div>`;
    }).join('')}`:'<p class="setting-guide">MCP連携はまだありません。</p>';
    $('mcp-form').classList.toggle('hidden',state.data.user.role!=='owner');
    $('mcp-batch-form').classList.toggle('hidden',state.data.user.role!=='owner');
    if($('mcp-refresh'))$('mcp-refresh').onclick=refreshSettings;
    document.querySelectorAll('[data-mcp-check]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await request('/api/mcp/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:button.dataset.mcpCheck})});await refreshSettings();$('settings-feedback').textContent='対象PCで接続を確認しています。しばらくして「接続状態を更新」を押してください。';}catch(e){$('settings-feedback').textContent=e.message;button.disabled=false;}});
    document.querySelectorAll('[data-mcp-remove]').forEach(button=>button.onclick=async()=>{if(!confirm('このMCP連携を解除しますか？'))return;try{await request('/api/mcp/remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:button.dataset.mcpRemove})});await refreshSettings();}catch(e){$('settings-feedback').textContent=e.message;}});
    $('chatwork-status').textContent = chatwork.configured ? `接続設定済み · ルーム ${chatwork.roomId} · 人待ち ${chatwork.pending}件` : '未設定';
  } catch(e) {$('settings-feedback').textContent=e.message;}
}
$('auth-form').onsubmit=async event=>{
  event.preventDefault();$('auth-error').textContent='';
  const mode=event.currentTarget.dataset.mode;
  const data={username:$('auth-username').value.trim(),password:$('auth-password').value};
  if(mode==='setup')data.token=new URLSearchParams(location.search).get('setup');
  try {
    await request(mode==='setup'?'/api/setup/complete':'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    if(mode==='setup') {history.replaceState(null,'',location.pathname);$('auth-form').dataset.mode='login';$('auth-title').textContent='レイにログイン';$('auth-help').textContent='登録完了。設定した情報でログインしてください。';$('auth-password').value='';}
    else {$('auth-screen').classList.add('hidden');await refresh();}
  } catch(e) {$('auth-error').textContent=e.message;}
};
$('settings-open').onclick=async()=>{$('settings-screen').classList.remove('hidden');await refreshSettings();};
$('settings-close').onclick=()=>{$('settings-screen').classList.add('hidden');};
$('pairing-form').onsubmit=async event=>{event.preventDefault();$('settings-feedback').textContent='';try{const hub=new URL($('pairing-url').value.trim());if(hub.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(hub.hostname))throw new Error('遠隔接続にはTailscale Serveが表示したHTTPSのURLを入力してください');const data=await request('/api/devices/pairing',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:$('pairing-label').value.trim()})});$('pairing-result').classList.remove('hidden');$('pairing-result').textContent=`Macでは次の1行、Windows PowerShellでは3行を実行してください（Node.jsとOpenClaw CLIは事前に必要です）:\nMac: git clone https://github.com/ywada-ga/rei-ai-company.git && cd rei-ai-company && node connector.mjs join\nWindows: git clone https://github.com/ywada-ga/rei-ai-company.git\ncd rei-ai-company\nnode connector.mjs join\n\n質問されたら入力:\n接続URL: ${hub.origin}\n接続コード（10分間有効）: ${data.code}\n\nTailscaleはこのPCと追加するPCの両方で同じネットワークにログインしてください。`;await refreshSettings();}catch(e){$('settings-feedback').textContent=e.message;}};
$('enroll-form').onsubmit=async event=>{event.preventDefault();$('settings-feedback').textContent='';try{const data=await request('/api/devices/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:$('device-label').value.trim(),isPlanner:$('device-planner').checked})});$('enroll-result').classList.remove('hidden');$('enroll-result').textContent=`${data.device.label} の接続トークン（この画面で一度だけ表示）: ${data.token}\n接続先: http://127.0.0.1:4178\n各Macで node connector.mjs setup を実行して入力してください。`;$('device-label').value='';await refreshSettings();await refresh();}catch(e){$('settings-feedback').textContent=e.message;}};
$('mcp-preset').innerHTML=MCP_PRESETS.map(preset=>`<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.title)}</option>`).join('');
function selectMcpPreset() {
  const preset=MCP_PRESETS.find(item=>item.id===$('mcp-preset').value);
  if(!preset)return;
  $('mcp-label').value=preset.label;
  $('mcp-url').value=preset.url;
  $('mcp-auth').value=preset.auth;
  const help=$('mcp-preset-help');
  help.textContent=preset.note;
  if(preset.docs){const link=document.createElement('a');link.href=preset.docs;link.target='_blank';link.rel='noopener noreferrer';link.textContent='公式の設定手順 ↗';help.append(' ',link);}
}
$('mcp-preset').onchange=selectMcpPreset;
selectMcpPreset();
$('mcp-batch-device').onchange=renderMcpPresetGrid;
$('mcp-batch-form').onsubmit=async event=>{
  event.preventDefault();
  $('settings-feedback').textContent='';
  const ids=[...$('mcp-preset-grid').querySelectorAll('input[name="mcp-preset"]:checked')].map(input=>input.value);
  if(!ids.length){$('settings-feedback').textContent='追加する連携先をチェックしてください';return;}
  const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;
  try {
    const result=await request('/api/mcp/add-batch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:$('mcp-batch-device').value,ids})});
    await refreshSettings();
    const needsOAuth=ids.some(id=>MCP_PRESETS.find(item=>item.id===id)?.auth==='oauth');
    $('settings-feedback').textContent=`${result.integrations.filter(item=>item.added).length}件を追加しました。${needsOAuth?'OAuthの連携先は対象PCで表示されたコマンドから認証してください。':''}`;
  } catch(e){$('settings-feedback').textContent=e.message;}
  finally {button.disabled=false;}
};
$('mcp-form').onsubmit=async event=>{event.preventDefault();$('settings-feedback').textContent='';try{await request('/api/mcp/add',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:$('mcp-label').value.trim(),url:$('mcp-url').value.trim(),deviceId:$('mcp-device').value,auth:$('mcp-auth').value})});$('settings-feedback').textContent='追加しました。対象PCに反映されるまで少し待ってから状態を更新してください。OAuthの場合は表示されたコマンドで認証します。';await refreshSettings();}catch(e){$('settings-feedback').textContent=e.message;}};
$('chatwork-form').onsubmit=async event=>{event.preventDefault();$('settings-feedback').textContent='';try{await request('/api/chatwork/configure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roomId:$('chatwork-room').value,token:$('chatwork-token').value})});$('chatwork-token').value='';await refreshSettings();}catch(e){$('settings-feedback').textContent=e.message;}};
$('invite-form').onsubmit=async event=>{event.preventDefault();$('settings-feedback').textContent='';try{const data=await request('/api/users/invite',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:$('invite-role').value})});$('invite-result').classList.remove('hidden');$('invite-result').textContent=`招待リンク（7日間有効）: ${location.origin}/?setup=${data.token}`;}catch(e){$('settings-feedback').textContent=e.message;}};
$('password-form').onsubmit=async event=>{event.preventDefault();$('settings-feedback').textContent='';try{await request('/api/auth/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({currentPassword:$('current-password').value,newPassword:$('new-password').value})});$('current-password').value='';$('new-password').value='';$('settings-feedback').textContent='パスワードを変更しました';}catch(e){$('settings-feedback').textContent=e.message;}};
$('logout').onclick=async()=>{await request('/api/auth/logout',{method:'POST'});state.data=null;$('settings-screen').classList.add('hidden');showAuth();};
tick();setInterval(tick,1000);refresh();setInterval(()=>{if(!document.hidden&&$('auth-screen').classList.contains('hidden'))refresh();},5000);
