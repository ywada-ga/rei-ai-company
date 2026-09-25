import { MCP_PRESETS } from './mcp-presets.js';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const formatTime = value => value ? new Intl.DateTimeFormat('ja-JP', { timeZone:'Asia/Tokyo', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value)) : '—';
const state = { data:null, view:'core', selectedDepartment:null, selectedTask:null, selectedProject:null, taskDetail:null, taskDetailLoading:null, olderTasks:[], hasMoreTasks:false, historyLoading:false, report:null, pendingReplyTaskId:null, voiceOn:false, mcpIntegrations:[], mcpSearch:'' };
const labels = { queued:'待機', ready:'待機', planning:'計画中', approval_pending:'承認待ち', running:'実行中', completed:'完了', failed:'失敗', interrupted:'中断', needs_review:'要確認', waiting_human:'人待ち', waiting_reply:'返答待ち', cancelled:'中止' };
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
    projects:['プロジェクト','PROJECT COMMAND','目的ごとに仕事と進捗をまとめます。'],
    briefing:['稼働報告','DAILY INTELLIGENCE','今日の実行記録を、接続済みのユニットから集約します。']
  }[view];
  $('view-title').innerHTML = `${copy[0]} <span>${copy[1]}</span>`;
  $('view-subtitle').textContent = copy[2];
  render();
  if (view === 'briefing' && !state.report) loadReport();
  if (view === 'missions') void loadTaskDetail();
}
async function refresh() {
  try { state.data = await request('/api/bootstrap'); if(!state.olderTasks.length)state.hasMoreTasks=state.data.hasOlderTasks; render(); if(state.view==='missions')void loadTaskDetail(); }
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
  const primaryPlanner=workers.some(w=>w.planner&&w.connected);
  const standbyPlanner=workers.some(w=>w.connected&&w.capabilities?.includes('planning'));
  $('system-signals').innerHTML = `<div class="signal-row"><span>REI HUB</span><b class="online">● ONLINE</b></div><div class="signal-row"><span>OPENCLAW端末</span><b class="${live ? 'online' : 'offline'}">${workers.filter(w=>w.connected).length} / ${workers.length} CONNECTED</b></div><div class="signal-row"><span>計画担当</span><b>${primaryPlanner?'READY':standbyPlanner?'予備PCが引継ぎ可能':'WAITING'}</b></div><div class="signal-row"><span>人の回答待ち</span><button id="human-pending-open" ${state.data.humanPending.length?'':'disabled'}>${state.data.humanPending.length}件 ↗</button></div><div class="signal-foot">端末の登録と状態は「端末・設定」で確認できます</div>`;
  $('human-pending-open').onclick=()=>{state.selectedTask=state.data.humanPending[0];setView('missions');};
  $('unit-list').innerHTML = workers.map(worker => {
    const connected = worker.connected;
    return `<div class="unit-row"><span class="unit-glyph ${connected ? 'online' : ''}">${worker.kind === '人' ? '♧' : worker.kind === '端末' ? '▣' : '✳'}</span><span><strong>${escapeHtml(worker.name)}</strong><small>${escapeHtml(worker.agentName?`OpenClaw: ${worker.agentName}`:worker.machine)}</small></span><i class="unit-led ${connected ? 'online' : ''}"></i></div>`;
  }).join('');
  renderFocus();
  renderMissions();
  renderProjects();
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
  const recentIds=new Set(state.data.tasks.map(task=>task.id));
  const tasks = [...state.data.tasks,...state.olderTasks.filter(task=>!recentIds.has(task.id))].filter(item => item.department === department.id);
  $('focus-content').innerHTML = `<div class="focus-active"><span>SELECTED SECTOR</span><h3>${escapeHtml(department.name)}</h3><p>${escapeHtml(department.detail)}</p><div><small>ASSIGNED MISSIONS</small><b>${String(tasks.length).padStart(2,'0')}</b></div><button id="focus-missions">仕事一覧を見る ↗</button></div>`;
  $('focus-missions').onclick = () => setView('missions');
}
function renderMissions() {
  if(document.activeElement?.closest('.human-reply-form,.reconcile-form,.reassign-form'))return;
  const recentIds=new Set(state.data.tasks.map(task=>task.id));
  const tasks = [...state.data.tasks,...state.olderTasks.filter(task=>!recentIds.has(task.id))];
  const projectName=id=>state.data.projects.find(project=>project.id===id)?.name||'単発の依頼';
  $('mission-total').textContent = `${String(tasks.length).padStart(2,'0')}${state.hasMoreTasks?'+':''} MISSIONS`;
  $('mission-list').innerHTML = (tasks.length ? tasks.map((task,index) => `<button class="mission-row ${state.selectedTask === task.id ? 'selected' : ''}" data-task="${escapeHtml(task.id)}"><span class="mission-index">${String(index+1).padStart(2,'0')}</span><span><strong>${escapeHtml(task.text)}</strong><small>${formatTime(task.createdAt)} · ${escapeHtml(projectName(task.projectId))}</small></span><em class="status ${escapeHtml(task.status)}">${state.data.humanPending.includes(task.id)?'人待ち':escapeHtml(labels[task.status] || task.status)}</em></button>`).join('') : `<div class="panel-empty tall"><span>◇</span><strong>ミッションはありません</strong><small>下の入力欄から最初の仕事を依頼してください。</small></div>`)+(state.hasMoreTasks?'<button id="mission-load-more" class="outline-button">過去の仕事をさらに表示</button>':'');
  const selected = tasks.find(item => item.id === state.selectedTask) || tasks[0];
  const detail=state.taskDetail?.task.id===selected?.id?state.taskDetail:null;
  const chosen=detail?.task||selected;
  const workerName=id=>state.data.workers.find(worker=>worker.id===id)?.name||'担当未定';
  const children=detail?.children||[];
  const events=detail?.events||[];
  $('mission-detail').innerHTML = chosen ? `<div class="detail-header"><span>MISSION FILE / ${escapeHtml(chosen.id.slice(0,8).toUpperCase())}</span><em class="status ${escapeHtml(chosen.status)}">${escapeHtml(labels[chosen.status] || chosen.status)}</em></div><h3>${escapeHtml(chosen.text)}</h3><div class="detail-facts"><div><span>プロジェクト</span><b>${escapeHtml(projectName(chosen.projectId))}</b></div><div><span>開始</span><b>${formatTime(chosen.startedAt)}</b></div><div><span>完了</span><b>${formatTime(chosen.finishedAt)}</b></div></div><div class="detail-result"><span>RESPONSE / RESULT</span><p>${escapeHtml(chosen.result || chosen.error || '実行結果を待っています。')}</p></div><div class="mission-actions">${detail?.canCancel?'<button id="task-cancel" class="outline-button">実行前の仕事を中止</button>':''}${detail?.canRetryPlan?'<button id="task-retry-plan" class="outline-button">計画を再実行</button>':''}<button id="task-reissue" class="outline-button">内容を再入力</button></div><div class="detail-steps"><h4>担当と進行状況</h4>${detail?children.map((child,index)=>`<div class="detail-step"><span>${String(index+1).padStart(2,'0')} / ${child.kind==='plan'?'計画':child.kind==='human'?'人への依頼':'実行'}</span><b>${escapeHtml(labels[child.status]||child.status)}</b><strong>${escapeHtml(child.text)}</strong><small>${escapeHtml(workerName(child.assignedDeviceId))}</small>${child.result||child.error?`<p>${escapeHtml(child.result||child.error)}</p>`:''}${child.kind==='human'&&['waiting_human','waiting_reply'].includes(child.status)&&['owner','admin'].includes(state.data.user.role)?`<form class="human-reply-form" data-human-reply="${escapeHtml(child.id)}"><label>人からの回答を記録<textarea required maxlength="8000" rows="3" placeholder="回答内容を入力"></textarea></label><button class="outline-button" type="submit">回答を記録</button></form>`:''}</div>`).join('')||'<p class="project-empty">工程はまだありません。</p>':'<p class="project-empty">工程を読み込んでいます。</p>'}</div><div class="detail-events"><h4>履歴</h4>${events.slice(-30).reverse().map(item=>`<div><time>${formatTime(item.createdAt)}</time><span>${escapeHtml(item.actor)} · ${escapeHtml(item.type)}</span><p>${escapeHtml(item.detail)}</p></div>`).join('')||'<p class="project-empty">履歴を読み込んでいます。</p>'}</div>` : `<div class="panel-empty tall"><span>⌕</span><strong>詳細を表示する仕事がありません</strong></div>`;
  if(detail&&['owner','admin'].includes(state.data.user.role)) {
    const cards=$('mission-detail').querySelectorAll('.detail-step');
    children.forEach((child,index)=>{if(child.status==='needs_review'&&['execute','human'].includes(child.kind))cards[index]?.insertAdjacentHTML('beforeend',`<form class="reconcile-form" data-reconcile="${escapeHtml(child.id)}"><label>確認結果<select required><option value="completed">実施済み</option><option value="failed">未実施・失敗</option></select></label><label>確認した内容<textarea required maxlength="8000" rows="3" placeholder="端末や担当者に確認した内容を入力"></textarea></label><button class="outline-button" type="submit">確認結果を記録</button></form>`);});
    children.forEach((child,index)=>{const alternatives=state.data.workers.filter(worker=>worker.connected&&worker.id!==child.assignedDeviceId);if(child.kind==='execute'&&child.status==='ready'&&alternatives.length)cards[index]?.insertAdjacentHTML('beforeend',`<form class="reassign-form" data-reassign="${escapeHtml(child.id)}"><label>担当PCを変更<select required>${alternatives.map(worker=>`<option value="${escapeHtml(worker.id)}">${escapeHtml(worker.name)}</option>`).join('')}</select></label><button class="outline-button" type="submit">未着手の仕事を移す</button></form>`);});
  }
  if($('task-cancel'))$('task-cancel').onclick=async()=>{if(!confirm('この仕事を実行前に中止しますか？'))return;try{await request('/api/tasks/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:chosen.id})});state.taskDetail=null;await refresh();}catch(error){feedback(error.message,true);}};
  if($('task-retry-plan'))$('task-retry-plan').onclick=async()=>{const button=$('task-retry-plan');button.disabled=true;try{await request('/api/tasks/retry-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:chosen.id})});state.taskDetail=null;await refresh();feedback('計画の再実行を依頼しました');}catch(error){feedback(error.message,true);button.disabled=false;}};
  if($('task-reissue'))$('task-reissue').onclick=()=>{$('command-input').value=chosen.text;$('command-project').value=chosen.projectId||'';$('command-input').focus();feedback('内容を確認してから送信してください');};
  document.querySelectorAll('.human-reply-form').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await request('/api/human/respond',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:form.dataset.humanReply,answer:form.querySelector('textarea').value.trim()})});form.querySelector('textarea').blur();state.taskDetail=null;await refresh();}catch(error){feedback(error.message,true);button.disabled=false;}});
  document.querySelectorAll('.reconcile-form').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await request('/api/tasks/reconcile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:form.dataset.reconcile,resolution:form.querySelector('select').value,note:form.querySelector('textarea').value.trim()})});form.querySelector('textarea').blur();state.taskDetail=null;await refresh();}catch(error){feedback(error.message,true);button.disabled=false;}});
  document.querySelectorAll('.reassign-form').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await request('/api/tasks/reassign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:form.dataset.reassign,deviceId:form.querySelector('select').value})});form.querySelector('select').blur();state.taskDetail=null;await refresh();feedback('未着手の仕事を別のPCへ移しました');}catch(error){feedback(error.message,true);button.disabled=false;}});
  document.querySelectorAll('#mission-list [data-task]').forEach(button=>button.onclick=()=>{state.selectedTask=button.dataset.task;setView('missions');});
  if($('mission-load-more'))$('mission-load-more').onclick=loadMoreTasks;
}
async function loadMoreTasks() {
  if(state.historyLoading)return;
  const cursor=state.olderTasks.at(-1)||state.data.tasks.at(-1);
  if(!cursor)return;
  state.historyLoading=true;
  const button=$('mission-load-more');if(button)button.disabled=true;
  try {const page=await request('/api/tasks/history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({beforeTime:Date.parse(cursor.createdAt),beforeId:cursor.id})});state.olderTasks.push(...page.tasks);state.hasMoreTasks=page.hasMore;renderMissions();}
  catch(error){feedback(error.message,true);if(button)button.disabled=false;}
  finally{state.historyLoading=false;}
}
async function loadTaskDetail() {
  const id=state.selectedTask||state.data?.tasks[0]?.id;
  if(!id||state.taskDetailLoading===id)return;
  state.taskDetailLoading=id;
  try {const detail=await request(`/api/tasks/detail/${id}`);if((state.selectedTask||state.data?.tasks[0]?.id)===id){state.taskDetail=detail;renderMissions();}}
  catch(error){feedback(error.message,true);}
  finally{if(state.taskDetailLoading===id)state.taskDetailLoading=null;}
}
function renderProjects() {
  const projects=state.data.projects||[];
  if(projects.length&&!projects.some(project=>project.id===state.selectedProject))state.selectedProject=projects[0].id;
  const select=$('command-project'),selected=select.value;
  select.innerHTML='<option value="">単発の依頼</option>'+projects.filter(project=>project.status==='active').map(project=>`<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('');
  select.value=projects.some(project=>project.id===selected&&project.status==='active')?selected:'';
  $('project-form').classList.toggle('hidden',!['owner','admin'].includes(state.data.user.role));
  $('project-total').textContent=`${String(projects.length).padStart(2,'0')} PROJECTS`;
  $('project-list').innerHTML=projects.length?projects.map(project=>`<button class="project-row ${state.selectedProject===project.id?'selected':''}" data-project="${escapeHtml(project.id)}"><span class="project-glyph">◈</span><span><strong>${escapeHtml(project.name)}</strong><small>${project.completed}/${project.total}件完了 · ${project.status==='active'?'稼働中':project.status==='paused'?'保留':'完了'}</small></span><em>${project.total?Math.round(project.completed/project.total*100):0}%</em></button>`).join(''):'<div class="panel-empty tall"><span>◈</span><strong>プロジェクトはまだありません</strong><small>目的を設定すると、複数の依頼をまとめて追跡できます。</small></div>';
  const project=projects.find(item=>item.id===state.selectedProject)||projects[0];
  const tasks=project?state.data.tasks.filter(task=>task.projectId===project.id):[];
  $('project-detail').innerHTML=project?`<div class="project-detail-inner"><span class="overline">PROJECT / ${escapeHtml(project.id.slice(0,8).toUpperCase())}</span><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.objective)}</p><div class="project-progress"><span style="width:${project.total?Math.round(project.completed/project.total*100):0}%"></span></div><div class="project-stats"><span>${project.total}件の依頼</span><span>${project.completed}件完了</span><span>${project.attention}件要確認</span></div>${['owner','admin'].includes(state.data.user.role)?`<label class="project-status-label">状態 <select id="project-status"><option value="active" ${project.status==='active'?'selected':''}>稼働中</option><option value="paused" ${project.status==='paused'?'selected':''}>保留</option><option value="completed" ${project.status==='completed'?'selected':''}>完了</option></select></label>`:''}<h4>最近の仕事</h4>${tasks.length?tasks.map(task=>`<button class="project-task" data-project-task="${escapeHtml(task.id)}"><span>${escapeHtml(task.text)}</span><em>${escapeHtml(labels[task.status]||task.status)}</em></button>`).join(''):'<p class="project-empty">このプロジェクトの仕事はまだありません。</p>'}${project.status==='active'?'<button id="project-assign" class="outline-button">このプロジェクトでレイに依頼 ↗</button>':''}</div>`:'<div class="panel-empty tall"><span>◇</span><strong>プロジェクトを選択</strong></div>';
  document.querySelectorAll('[data-project]').forEach(button=>button.onclick=()=>{state.selectedProject=button.dataset.project;renderProjects();});
  document.querySelectorAll('[data-project-task]').forEach(button=>button.onclick=()=>{state.selectedTask=button.dataset.projectTask;setView('missions');});
  if($('project-assign'))$('project-assign').onclick=()=>{select.value=project.id;$('command-input').focus();};
  if($('project-status'))$('project-status').onchange=async event=>{const value=event.target.value;try{await request('/api/projects/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:project.id,status:value})});await refresh();}catch(error){$('project-feedback').textContent=error.message;await refresh();}};
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
  const rows=(report.devices||[]).filter(device=>!device.revoked||device.total).map(device=>{const unit=units.find(item=>item.id===device.id);return `<li>${escapeHtml(device.label)} <b>${device.total}工程 / 完了${device.completed} / 実行中${device.running} / 要確認${device.attention} · ${unit?.connected?'接続中':'未接続'}</b></li>`;}).join('');
  const people=report.people?.total?`<li>人への依頼 <b>${report.people.total}件 / 回答${report.people.completed} / 待機${report.people.waiting} / 要確認${report.people.attention}</b></li>`:'';
  $('briefing-content').innerHTML = `<div class="brief-grid"><div class="glass-panel briefing-lead"><span>BRIEFING / ${escapeHtml(report.day)}</span><h3>本日の稼働状況</h3><p>REIに登録された端末は <b>${units.length}台</b>、現在接続中は <b>${connected}台</b>。本日の依頼は <b>${report.total}件</b>です。</p><div class="brief-stats"><div><small>COMPLETED</small><strong>${report.completed}</strong><span>完了</span></div><div><small>IN PROGRESS</small><strong>${report.running}</strong><span>進行中</span></div><div><small>NEEDS ATTENTION</small><strong>${report.failed+report.interrupted}</strong><span>要確認</span></div></div></div><div class="glass-panel briefing-scope"><span>DATA SCOPE</span><h3>PC・人の稼働</h3><p>このREI Hubで記録した仕事だけを集計しています。端末の他用途の活動は含みません。</p><ul>${rows||'<li>登録端末なし</li>'}${people}</ul></div></div><div class="glass-panel briefing-tasks"><div class="panel-heading"><span>RECORDED MISSIONS</span><span>${report.total} ENTRIES</span></div>${report.tasks.length?report.tasks.map(task=>`<div class="brief-task"><span class="status ${escapeHtml(task.status)}">${escapeHtml(labels[task.status]||task.status)}</span><div><strong>${escapeHtml(task.text)}</strong><small>${escapeHtml(task.summary)}</small></div><span>${formatTime(task.createdAt)}</span></div>`).join(''):'<div class="panel-empty"><strong>今日の仕事はまだありません</strong></div>'}</div>`;
}
document.querySelectorAll('.rail-btn').forEach(button => button.onclick = () => setView(button.dataset.view));
$('refresh').onclick = refresh;
$('report-refresh').onclick = loadReport;
$('project-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('[type="submit"]');button.disabled=true;$('project-feedback').textContent='';try{const result=await request('/api/projects/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('project-name').value.trim(),objective:$('project-objective').value.trim()})});$('project-name').value='';$('project-objective').value='';state.selectedProject=result.project.id;await refresh();$('command-project').value=result.project.id;$('project-feedback').textContent='プロジェクトを作成しました';}catch(error){$('project-feedback').textContent=error.message;}finally{button.disabled=false;}};
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
    const result = await request('/api/command', { method:'POST', headers:{ 'Content-Type':'application/json', 'X-AI-Company':'1' }, body:JSON.stringify({ text, department:state.selectedDepartment || 'operations', projectId:$('command-project').value||null }) });
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
  const role=state.data.user.role;
  $('signed-in-user').textContent = `${state.data.user.username} / ${{owner:'所有者',admin:'管理者',requester:'依頼者',viewer:'閲覧者'}[role]||role}`;
  $('backup-create').classList.toggle('hidden',role!=='owner');
  $('invite-form').classList.toggle('hidden',!['owner','admin'].includes(role));
  $('invite-role').querySelector('option[value="admin"]').disabled=role!=='owner';
  if(role!=='owner'&&$('invite-role').value==='admin')$('invite-role').value='requester';
  if(!$('user-management')){const panel=document.createElement('div');panel.id='user-management';$('invite-form').before(panel);}
  if(['owner','admin'].includes(role)){
    try {
      const {users}=await request('/api/users/list');
      $('user-management').innerHTML=users.map(member=>`<div class="setting-device"><span><b>${escapeHtml(member.username)}</b><small>${member.disabled?'停止中 · ':''}${{owner:'所有者',admin:'管理者',requester:'依頼者',viewer:'閲覧者'}[member.role]||member.role}</small></span>${role==='owner'&&member.role!=='owner'?`<span class="user-controls"><select data-user-role="${escapeHtml(member.id)}" aria-label="${escapeHtml(member.username)}の権限"><option value="admin" ${member.role==='admin'?'selected':''}>管理者</option><option value="requester" ${member.role==='requester'?'selected':''}>依頼者</option><option value="viewer" ${member.role==='viewer'?'selected':''}>閲覧者</option></select><button data-user-disable="${escapeHtml(member.id)}" data-disabled="${member.disabled?'1':'0'}" class="outline-button">${member.disabled?'再開':'停止'}</button></span>`:''}</div>`).join('');
      document.querySelectorAll('[data-user-role]').forEach(select=>select.onchange=async()=>{try{await request('/api/users/role',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:select.dataset.userRole,role:select.value})});await refreshSettings();}catch(e){$('settings-feedback').textContent=e.message;await refreshSettings();}});
      document.querySelectorAll('[data-user-disable]').forEach(button=>button.onclick=async()=>{const disabled=button.dataset.disabled!=='1';if(disabled&&!confirm('この利用者を停止し、現在のログインを解除しますか？'))return;try{await request('/api/users/disable',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:button.dataset.userDisable,disabled})});await refreshSettings();}catch(e){$('settings-feedback').textContent=e.message;}});
    }catch(e){$('user-management').textContent=e.message;}
  }else $('user-management').textContent='利用者の管理は管理者が行います。';
  const pending=state.data.tasks.filter(task=>task.status==='approval_pending');
  $('approval-management').innerHTML=pending.length?pending.map(task=>`<div class="setting-device"><span><b>${escapeHtml(task.text)}</b><small>依頼者の仕事</small></span><span><button data-approve="${escapeHtml(task.id)}" class="outline-button">承認</button><button data-reject="${escapeHtml(task.id)}" class="outline-button">却下</button></span></div>`).join(''):'<p>承認待ちはありません。</p>';
  document.querySelectorAll('[data-approve],[data-reject]').forEach(button=>button.onclick=async()=>{const route=button.dataset.approve?'approve':'reject',taskId=button.dataset.approve||button.dataset.reject;try{await request(`/api/tasks/${route}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId})});await refresh();await refreshSettings();}catch(e){$('settings-feedback').textContent=e.message;}});
  try {
    const [devices,chatwork,mcp] = await Promise.all([request('/api/devices'),request('/api/chatwork/status'),request('/api/mcp/list')]);
    $('device-management').innerHTML = devices.devices.length ? devices.devices.map(d=>`<div class="setting-device"><span><b>${escapeHtml(d.label)}</b><small>${d.online?'● 接続中':'○ 未接続'}${d.planner?' · REI計画担当':''}${d.agent_name?` · OpenClaw: ${escapeHtml(d.agent_name)}`:''}</small></span><button data-revoke="${escapeHtml(d.id)}" class="outline-button">解除</button></div>`).join('') : '<p>端末はまだ登録されていません。</p>';
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
const networkPanel=document.createElement('div');networkPanel.id='network-setup';networkPanel.className='network-setup';$('pairing-form').before(networkPanel);
$('pairing-form').previousElementSibling.previousElementSibling.textContent='別のPCを追加するには、このPCと追加するPCでTailscaleアプリにログインします。接続できたら下のコードを発行してください。';
async function loadNetworkStatus() {
  networkPanel.textContent='安全な接続を確認しています…';
  try {
    const status=await request('/api/network/status');
    if(status.state==='missing')networkPanel.innerHTML='<strong>① このPCにTailscaleを入れる</strong><p>PC間を安全につなぐアプリです。インストール後、同じアカウントでログインしてください。</p><a href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer">公式サイトから入手 ↗</a><button id="network-refresh" class="outline-button" type="button">接続を再確認</button>';
    else if(status.state==='login_required')networkPanel.innerHTML='<strong>① Tailscaleへログイン</strong><p>このPCのTailscaleアプリを開いてログインしてください。</p><button id="network-refresh" class="outline-button" type="button">接続を再確認</button>';
    else if(status.state==='ready')networkPanel.innerHTML='<strong>② このPCの接続を有効にする</strong><p>Tailscale内だけでREIを開けるようにします。</p><button id="network-enable" class="outline-button" type="button">安全な接続を有効にする</button>';
    else if(status.state==='connected'){networkPanel.innerHTML=`<strong>✓ このPCの接続準備ができました</strong><p>接続URL: <code>${escapeHtml(status.url)}</code></p><p>追加するPCにもTailscaleを入れ、同じアカウントでログインしてください。</p>`;if(!$('pairing-url').value)$('pairing-url').value=status.url;}
    else networkPanel.innerHTML='<strong>接続状態を読めませんでした</strong><button id="network-refresh" class="outline-button" type="button">もう一度確認</button>';
    if($('network-refresh'))$('network-refresh').onclick=loadNetworkStatus;
    if($('network-enable'))$('network-enable').onclick=async()=>{const button=$('network-enable');button.disabled=true;try{await request('/api/network/serve',{method:'POST'});await loadNetworkStatus();}catch(error){networkPanel.textContent=error.message;}};
  }catch(error){networkPanel.textContent=error.message;}
}
$('settings-open').onclick=async()=>{$('settings-screen').classList.remove('hidden');void loadNetworkStatus();await refreshSettings();};
$('settings-close').onclick=()=>{$('settings-screen').classList.add('hidden');};
$('backup-create').onclick=async()=>{const button=$('backup-create');button.disabled=true;$('backup-result').textContent='データを保存しています…';try{const result=await request('/api/backup/create',{method:'POST'});$('backup-result').textContent=`保存先: ${result.folder}\nこのフォルダを外部ストレージにもコピーしてください。`;}catch(error){$('backup-result').textContent=error.message;}finally{button.disabled=false;}};
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
