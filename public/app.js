import { MCP_PRESETS } from './mcp-presets.js';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const formatTime = value => value ? new Intl.DateTimeFormat('ja-JP', { timeZone:'Asia/Tokyo', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value)) : '—';
const state = { data:null, authEpoch:0, view:'core', selectedDepartment:null, selectedTask:null, selectedProject:null, projectWork:null, projectWorkLoadedAt:0, projectWorkRequest:0, projectWorkQuery:'', projectNotes:null, projectNotesLoading:false, projectNotesQuery:'', projectNotesRequest:0, playbooks:null, playbooksLoading:false, playbookQuery:'', playbookDepartment:'all', skillPane:'library', playbooksRequest:0, selectedPlaybook:null, selectedCommandSkill:null, taskDetail:null, taskDetailLoading:null, eventVisibleCount:30, eventHistoryExpanded:false, eventsLoading:false, olderTasks:[], hasMoreTasks:false, historyLoading:false, report:null, reportLoadedAt:0, reportLoading:false, pendingReplyTaskId:null, voiceOn:false, mcpIntegrations:[], mcpSearch:'' };
const labels = { queued:'待機', ready:'待機', planning:'計画中', approval_pending:'承認待ち', running:'実行中', completed:'完了', failed:'失敗', interrupted:'中断', needs_review:'要確認', waiting_human:'人待ち', waiting_reply:'返答待ち', cancelled:'中止' };
const icons = ['◉','✧','⬡','↗','◇','♧'];
const departmentName=id=>({all:'全セクション',operations:'経営・運営',research:'調査・企画',production:'制作・開発',sales:'営業・顧客',support:'サポート',people:'人との連携'})[id]||id;
// https://motion.aibl-portal.com/motion/14-tilt-deck informed the restrained
// perspective and eased response. The idle camera keeps moving without a mouse.
function initHologramMotion() {
  const field=document.querySelector('.orbit-field');
  if(!field||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const finePointer=matchMedia('(pointer: fine)').matches;
  let pointerX=0,pointerY=0,pointerActive=false,currentX=0,currentY=0,running=false,last=0;
  const paint=time=>{
    if(document.hidden||!field.offsetWidth){running=false;return;}
    if(time-last<30){requestAnimationFrame(paint);return;}
    last=time;
    const targetX=pointerActive?pointerX:Math.sin(time*.00031)*.45;
    const targetY=pointerActive?pointerY:Math.cos(time*.00023)*.38;
    currentX+=(targetX-currentX)*.12;
    currentY+=(targetY-currentY)*.12;
    field.style.setProperty('--holo-x',`${(currentX*11).toFixed(2)}px`);
    field.style.setProperty('--holo-y',`${(currentY*9).toFixed(2)}px`);
    field.style.setProperty('--holo-rotate-x',`${(-currentY*5).toFixed(2)}deg`);
    field.style.setProperty('--holo-rotate-y',`${(currentX*5).toFixed(2)}deg`);
    field.style.setProperty('--holo-glint-x',`${(50+currentX*23).toFixed(2)}%`);
    field.style.setProperty('--holo-glint-y',`${(50+currentY*23).toFixed(2)}%`);
    requestAnimationFrame(paint);
  };
  const start=()=>{if(!running&&!document.hidden&&field.offsetWidth){running=true;requestAnimationFrame(paint);}};
  field.addEventListener('pointermove',event=>{
    if(!finePointer)return;
    const rect=field.getBoundingClientRect();
    pointerX=Math.max(-1,Math.min(1,(event.clientX-rect.left)/rect.width*2-1));
    pointerY=Math.max(-1,Math.min(1,(event.clientY-rect.top)/rect.height*2-1));
    pointerActive=true;
  });
  field.addEventListener('pointerleave',()=>{pointerActive=false;});
  new IntersectionObserver(entries=>{if(entries[0].isIntersecting)start();}).observe(field);
  document.addEventListener('visibilitychange',start);
  start();
}
initHologramMotion();
// https://motion.aibl-portal.com/motion/154-curl-noise-smoke inspired this
// self-moving luminous vortex. The shader stays offline and behind controls.
function initWebGLSmoke(canvas,field) {
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:false});
  if(!gl)return false;
  const vertex=`#version 300 es
precision highp float;
in vec4 aSeed;
uniform float uTime,uAspect,uPixel;
out float vAlpha;
void main(){
  float age=fract(aSeed.w+uTime*.105);
  float flow=aSeed.x*6.28318+age*7.7+uTime*.23;
  float curl=sin(aSeed.y*15.0+age*16.0+uTime*.53)*.17
            +cos(aSeed.z*9.0+age*11.0-uTime*.41)*.11;
  float radius=.16+age*.84+curl;
  vec3 p=vec3(cos(flow)*radius,sin(flow)*radius*.88,
              aSeed.z*.62+sin(flow*2.3+age*10.0)*.25);
  float yaw=sin(uTime*.31)*.24,pitch=cos(uTime*.23)*.19;
  p=vec3(p.x*cos(yaw)+p.z*sin(yaw),p.y,p.z*cos(yaw)-p.x*sin(yaw));
  p=vec3(p.x,p.y*cos(pitch)-p.z*sin(pitch),p.y*sin(pitch)+p.z*cos(pitch));
  float perspective=1.0/(1.0-p.z*.38);
  gl_Position=vec4(p.x*perspective*.88/uAspect,p.y*perspective*.88,0.0,1.0);
  gl_PointSize=min((4.0+6.0*(1.0-age))*uPixel*perspective,22.0);
  vAlpha=smoothstep(0.0,.13,age)*(1.0-smoothstep(.65,1.0,age))
         *(.42+.36*clamp(p.z+1.0,0.0,1.0));
}`;
  const fragment=`#version 300 es
precision highp float;
in float vAlpha;
out vec4 outColor;
void main(){
  float radius=length(gl_PointCoord*2.0-1.0);
  float glow=pow(max(0.0,1.0-radius),1.25);
  outColor=vec4(.45,.88,1.0,vAlpha*glow);
}`;
  const shader=(type,source)=>{const value=gl.createShader(type);gl.shaderSource(value,source);gl.compileShader(value);return value;};
  const program=gl.createProgram();
  gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));
  gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){console.warn('Hologram shader unavailable',gl.getProgramInfoLog(program));return true;}
  gl.useProgram(program);
  const count=6144,seeds=new Float32Array(count*4);
  for(let index=0;index<count;index++){
    seeds[index*4]=(index%3)/3+(Math.random()-.5)*.12;
    seeds[index*4+1]=Math.random();
    seeds[index*4+2]=Math.random()*2-1;
    seeds[index*4+3]=Math.random();
  }
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,seeds,gl.STATIC_DRAW);
  const location=gl.getAttribLocation(program,'aSeed');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,4,gl.FLOAT,false,0,0);
  const timeUniform=gl.getUniformLocation(program,'uTime');
  const aspectUniform=gl.getUniformLocation(program,'uAspect');
  const pixelUniform=gl.getUniformLocation(program,'uPixel');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width=0,height=0,last=0,running=false;
  const resize=()=>{
    const rect=field.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
    width=rect.width;height=rect.height;
    canvas.width=Math.max(1,Math.round(width*dpr));canvas.height=Math.max(1,Math.round(height*dpr));
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.uniform1f(aspectUniform,width/Math.max(height,1));gl.uniform1f(pixelUniform,dpr);
    if(reduced)draw(0);
  };
  const draw=time=>{
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
    gl.uniform1f(timeUniform,time*.001);gl.drawArrays(gl.POINTS,0,count);
  };
  const frame=time=>{
    if(document.hidden||!canvas.offsetWidth){running=false;return;}
    if(time-last>30){draw(time);last=time;}
    requestAnimationFrame(frame);
  };
  const start=()=>{if(!reduced&&!running&&!document.hidden&&canvas.offsetWidth){running=true;requestAnimationFrame(frame);}};
  new ResizeObserver(()=>{resize();start();}).observe(field);
  new IntersectionObserver(entries=>{if(entries[0].isIntersecting)start();}).observe(canvas);
  document.addEventListener('visibilitychange',start);
  resize();start();
  return true;
}
// Canvas fallback retains an animated 3D projection on devices without WebGL2.
function initHologramParticles() {
  const canvas=$('hologram-particles'),field=document.querySelector('.orbit-field');
  if(!canvas||!field||initWebGLSmoke(canvas,field))return;
  const context=canvas?.getContext('2d');
  if(!context||!field)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const points=Array.from({length:2200},(_,index)=>{
    const along=Math.floor(index/3)/734,stream=index%3;
    return {along,stream,phase:Math.sin(index*12.9898)*.75,depth:Math.sin(index*7.213)*.7,size:index%29===0?2.3:1.05};
  });
  let width=0,height=0,last=0,running=false,viewX=0,viewY=0;
  const resize=()=>{
    const rect=field.getBoundingClientRect();
    width=rect.width;height=rect.height;
    const dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.round(width*dpr));
    canvas.height=Math.max(1,Math.round(height*dpr));
    context.setTransform(dpr,0,0,dpr,0,0);
    if(reduced)draw(0);
  };
  const draw=time=>{
    context.clearRect(0,0,width,height);
    const phase=reduced?0:time*.001;
    const yaw=Math.sin(phase*.32)*.22+viewX*.09;
    const pitch=Math.cos(phase*.24)*.19+viewY*.07;
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cx=Math.cos(pitch),sx=Math.sin(pitch);
    const reach=Math.min(width,height)*.42;
    context.globalCompositeOperation='lighter';
    context.shadowColor='#40caff';
    for(const point of points){
      const travel=point.along*Math.PI*3.4+point.stream*Math.PI*2/3+phase*.48;
      const curl=.19*Math.sin(point.depth*3.7+phase*.57+point.phase);
      const angle=travel+curl+point.phase*.13;
      const radius=.19+point.along*.84+.075*Math.sin(travel*2+point.phase);
      const px=Math.cos(angle)*radius,py=Math.sin(angle)*radius*.86;
      const pz=point.depth*.7+.23*Math.sin(travel*1.7+phase*.41+point.phase);
      const x=px*cy+pz*sy,z=pz*cy-px*sy;
      const y=py*cx-z*sx,depth=py*sx+z*cx;
      const scale=1/(1-depth*.34);
      const alpha=Math.max(.15,Math.min(.8,.4+depth*.27));
      context.fillStyle=`rgba(111,225,255,${alpha})`;
      context.shadowBlur=point.size>2?9:0;
      context.beginPath();
      context.arc(width/2+x*reach*scale,height/2+y*reach*scale,point.size*scale,0,Math.PI*2);
      context.fill();
    }
    context.shadowBlur=0;
    context.globalCompositeOperation='source-over';
  };
  const frame=time=>{
    if(document.hidden||!canvas.offsetWidth){running=false;return;}
    if(time-last>30){draw(time);last=time;}
    requestAnimationFrame(frame);
  };
  const start=()=>{if(!reduced&&!running&&!document.hidden&&canvas.offsetWidth){running=true;requestAnimationFrame(frame);}};
  field.addEventListener('pointermove',event=>{
    const rect=field.getBoundingClientRect();
    viewX=(event.clientX-rect.left)/rect.width*2-1;
    viewY=(event.clientY-rect.top)/rect.height*2-1;
  });
  field.addEventListener('pointerleave',()=>{viewX=viewY=0;});
  new ResizeObserver(()=>{resize();start();}).observe(field);
  new IntersectionObserver(entries=>{if(entries[0].isIntersecting)start();}).observe(canvas);
  document.addEventListener('visibilitychange',start);
  resize();start();
}
initHologramParticles();
function commandSkill(skill) {state.selectedCommandSkill=skill||null;$('command-skill').textContent=skill?`使用スキル: ${skill.title} ×`:'';$('command-skill').classList.toggle('hidden',!skill);}

function setSkillPane(pane){if(pane==='create'&&state.data?.user.role==='viewer')pane='library';state.skillPane=pane;document.querySelector('.playbook-grid').classList.toggle('hidden',pane!=='library');$('playbook-search-form').classList.toggle('hidden',pane!=='library');$('playbook-total').classList.toggle('hidden',pane!=='library');$('playbook-form').classList.toggle('hidden',pane!=='create');document.querySelector('.marketplace-panel').classList.toggle('hidden',pane!=='marketplace');document.querySelector('[data-skill-pane="create"]').classList.toggle('hidden',state.data?.user.role==='viewer');document.querySelectorAll('[data-skill-pane]').forEach(button=>button.classList.toggle('active',button.dataset.skillPane===pane));}

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
function addCopyActions(container,actions) {
  const row=document.createElement('div');row.className='secret-actions';
  for(const [label,value] of actions) {
    const button=document.createElement('button');button.type='button';button.className='outline-button';button.textContent=label;
    button.onclick=async()=>{try{await navigator.clipboard.writeText(value);button.textContent='コピーしました';}catch{button.textContent='コピーできませんでした';}};
    row.append(button);
  }
  container.append(row);
}
function setView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('hidden', element.id !== `${view}-view`));
  document.querySelectorAll('.rail-btn').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  const copy = {
    core:['レイ','COMMAND CENTER','レイに目的を伝える。AI会社が仕事を動かす。'],
    missions:['ミッション','MISSION CONTROL','指示から実行、結果までを追跡します。'],
    projects:['プロジェクト','PROJECT COMMAND','目的ごとに仕事と進捗をまとめます。'],
    playbooks:['スキル','CREATE / FIND SKILL','チームの手順と知識をセクション別に共有し、仕事に指定できます。'],
    briefing:['稼働報告','DAILY INTELLIGENCE','今日の実行記録を、接続済みのユニットから集約します。']
  }[view];
  $('view-title').innerHTML = `${copy[0]} <span>${copy[1]}</span>`;
  $('view-subtitle').textContent = copy[2];
  render();
  if (view === 'projects') {void loadProjectNotes();void loadProjectWork();}
  if (view === 'playbooks') {setSkillPane(state.skillPane);void loadPlaybooks();}
  if (view === 'briefing' && Date.now()-state.reportLoadedAt>10000) void loadReport();
  if (view === 'missions') void loadTaskDetail();
}
async function refresh() {
  const epoch=state.authEpoch;
  try { const data=await request('/api/bootstrap'); if(epoch!==state.authEpoch)return; state.data=data; if(!state.olderTasks.length)state.hasMoreTasks=state.data.hasOlderTasks; render(); if(state.view==='missions')void loadTaskDetail(); if(state.view==='projects')void loadProjectWork(); if(state.view==='briefing'&&Date.now()-state.reportLoadedAt>30000)void loadReport(true); }
  catch (error) { if(epoch!==state.authEpoch||error.message==='ログインしてください')return;feedback(error.message, true); $('system-status').textContent = 'OFFLINE'; }
}
function render() {
  if (!state.data) return;
  const { departments, workers, tasks, gateway } = state.data;
  const live = gateway.reachable;
  $('system-status').textContent = live ? 'ONLINE' : 'NO AGENT';
  $('system-status').classList.toggle('offline', !live);
  $('stage-status').textContent = live ? 'AGENT LINK ESTABLISHED' : 'NO AGENT CONNECTED';
  $('core-state').textContent = live ? 'CONNECTED / READY' : 'WAITING FOR AGENT';
  $('agent-count').textContent = String(workers.filter(w=>w.connected).length).padStart(2,'0');
  $('running-count').textContent = String(tasks.filter(task => ['running','planning'].includes(task.status)).length).padStart(2,'0');
  $('network-count').textContent = `${String(workers.filter(w=>w.connected).length).padStart(2,'0')} / ${String(workers.length).padStart(2,'0')}`;
  $('department-orbit').innerHTML = departments.map((department,index) => {
    const active = tasks.filter(task => task.department === department.id && task.status === 'running').length;
    return `<button class="orbit-node node-${index} ${state.selectedDepartment === department.id ? 'selected' : ''}" data-department="${escapeHtml(department.id)}"><span class="node-icon">${icons[index]}</span><span class="node-copy"><small>SECTOR 0${index+1}</small><strong>${escapeHtml(department.name)}</strong><em>${active ? `${active} ACTIVE` : 'STANDBY'}</em></span></button>`;
  }).join('');
  $('mission-feed').innerHTML = tasks.length ? tasks.slice(0,3).map(task => `<div class="exchange"><div class="exchange-user"><small>YOU / ${formatTime(task.createdAt)}</small><p>${escapeHtml(task.text)}</p></div><div class="exchange-rei"><small>REI / ${escapeHtml(labels[task.status] || task.status)}</small><p>${escapeHtml((task.result || task.error || '承知しました。実行しています…').slice(0,420))}</p></div><button data-task="${escapeHtml(task.id)}">詳細を見る ↗</button></div>`).join('') : `<div class="panel-empty"><span>○</span><strong>おかえりなさい</strong><small>レイは次の指示をお待ちしています。</small></div>`;
  const primaryPlanner=workers.some(w=>w.planner&&w.connected&&w.version===gateway.version&&w.capabilities?.includes('planning'));
  const standbyPlanner=workers.some(w=>w.connected&&w.version===gateway.version&&w.capabilities?.includes('planning'));
  const pendingResults=workers.reduce((count,worker)=>count+(worker.pendingResults||0),0);
  const outdated=workers.filter(worker=>worker.connected&&worker.version!==gateway.version).length;
  $('system-signals').innerHTML = `<div class="signal-row"><span>REI HUB</span><b class="online">● ONLINE · ${escapeHtml(gateway.version)}</b></div><div class="signal-row"><span>OPENCLAW端末</span><b class="${live ? 'online' : 'offline'}">${workers.filter(w=>w.connected).length} / ${workers.length} CONNECTED</b></div><div class="signal-row"><span>計画担当</span><b>${primaryPlanner?'READY':standbyPlanner?'予備PCが引継ぎ可能':'WAITING'}</b></div>${outdated?`<div class="signal-row"><span>更新が必要なPC</span><b class="offline">${outdated}台 · 端末を確認</b></div>`:''}${pendingResults?`<div class="signal-row"><span>結果の送信待ち</span><b class="offline">${pendingResults}件 · 端末を確認</b></div>`:''}<div class="signal-row"><span>人の回答待ち</span><button id="human-pending-open" ${state.data.humanPending.length?'':'disabled'}>${state.data.humanPending.length}件 ↗</button></div><div class="signal-foot">端末の登録と状態は「端末・設定」で確認できます</div>`;
  $('human-pending-open').onclick=()=>{state.selectedTask=state.data.humanPending[0];setView('missions');};
  $('unit-list').innerHTML = workers.map(worker => {
    const connected = worker.connected;
    return `<div class="unit-row"><span class="unit-glyph ${connected ? 'online' : ''}">${worker.kind === '人' ? '♧' : worker.kind === '端末' ? '▣' : '✳'}</span><span><strong>${escapeHtml(worker.name)}</strong><small>${escapeHtml(worker.pendingResults?`結果送信待ち ${worker.pendingResults}件`:worker.version!==gateway.version?`REI ${worker.version||'版未報告'} · 更新が必要`:worker.agentName?`OpenClaw: ${worker.agentName}`:worker.machine)}</small></span><i class="unit-led ${connected ? 'online' : ''}"></i></div>`;
  }).join('');
  renderFocus();
  renderMissions();
  renderProjects();
  renderPlaybooks();
  renderBriefing();
  const reply = tasks.find(task => task.id === state.pendingReplyTaskId);
  if (reply && ['completed','failed','interrupted','needs_review'].includes(reply.status)) {
    state.pendingReplyTaskId = null;
    feedback(reply.status === 'completed' ? 'レイから返答が届きました' : 'レイから確認が必要な報告があります', reply.status !== 'completed');
    if (state.voiceOn) speak(reply.result || reply.error || '処理を完了できませんでした。');
  }
  document.querySelectorAll('[data-department]').forEach(element => element.onclick = () => { state.selectedDepartment = element.dataset.department; if(state.selectedCommandSkill&&state.selectedCommandSkill.department!=='all'&&state.selectedCommandSkill.department!==state.selectedDepartment)commandSkill(null); render(); });
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
  if(document.activeElement?.closest('.human-reply-form,.reconcile-form,.reassign-form,.acknowledge-failure-form'))return;
  const recentIds=new Set(state.data.tasks.map(task=>task.id));
  const tasks = [...state.data.tasks,...state.olderTasks.filter(task=>!recentIds.has(task.id))];
  if(state.taskDetail?.task&&!tasks.some(task=>task.id===state.taskDetail.task.id))tasks.unshift(state.taskDetail.task);
  const projectName=id=>state.data.projects.find(project=>project.id===id)?.name||'単発の依頼';
  $('mission-total').textContent = `${String(tasks.length).padStart(2,'0')}${state.hasMoreTasks?'+':''} MISSIONS`;
  $('mission-list').innerHTML = (tasks.length ? tasks.map((task,index) => `<button class="mission-row ${state.selectedTask === task.id ? 'selected' : ''}" data-task="${escapeHtml(task.id)}"><span class="mission-index">${String(index+1).padStart(2,'0')}</span><span><strong>${escapeHtml(task.text)}</strong><small>${formatTime(task.createdAt)} · ${escapeHtml(projectName(task.projectId))}</small></span><em class="status ${escapeHtml(task.status)}">${state.data.humanPending.includes(task.id)?'人待ち':escapeHtml(labels[task.status] || task.status)}</em></button>`).join('') : `<div class="panel-empty tall"><span>◇</span><strong>ミッションはありません</strong><small>下の入力欄から最初の仕事を依頼してください。</small></div>`)+(state.hasMoreTasks?'<button id="mission-load-more" class="outline-button">過去の仕事をさらに表示</button>':'');
  const selected = tasks.find(item => item.id === state.selectedTask) || (!state.selectedTask?tasks[0]:null);
  const detail=state.taskDetail?.task.id===selected?.id?state.taskDetail:null;
  const chosen=detail?.task||selected;
  const workerName=id=>state.data.workers.find(worker=>worker.id===id)?.name||'担当未定';
  const children=detail?.children||[];
  const events=detail?.events||[];
  $('mission-detail').innerHTML = chosen ? `<div class="detail-header"><span>MISSION FILE / ${escapeHtml(chosen.id.slice(0,8).toUpperCase())}</span><em class="status ${escapeHtml(chosen.status)}">${escapeHtml(labels[chosen.status] || chosen.status)}</em></div><h3>${escapeHtml(chosen.text)}</h3><div class="detail-facts"><div><span>プロジェクト</span><b>${escapeHtml(projectName(chosen.projectId))}</b></div><div><span>開始</span><b>${formatTime(chosen.startedAt)}</b></div><div><span>完了</span><b>${formatTime(chosen.finishedAt)}</b></div></div><div class="detail-result"><span>RESPONSE / RESULT</span><p>${escapeHtml(chosen.result || chosen.error || '実行結果を待っています。')}</p></div><div class="mission-actions">${detail?.canCancel?'<button id="task-cancel" class="outline-button">実行前の仕事を中止</button>':''}${detail?.canRetryPlan?'<button id="task-retry-plan" class="outline-button">計画を再実行</button>':''}<button id="task-reissue" class="outline-button">内容を再入力</button></div><div class="detail-steps"><h4>担当と進行状況</h4>${detail?children.map((child,index)=>`<div class="detail-step"><span>${String(index+1).padStart(2,'0')} / ${child.kind==='plan'?'計画':child.kind==='human'?'人への依頼':'実行'}</span><b>${escapeHtml(labels[child.status]||child.status)}</b><strong>${escapeHtml(child.text)}</strong><small>${escapeHtml(workerName(child.assignedDeviceId))}</small>${child.result||child.error?`<p>${escapeHtml(child.result||child.error)}</p>`:''}${child.kind==='human'&&['waiting_human','waiting_reply'].includes(child.status)&&['owner','admin'].includes(state.data.user.role)?`<form class="human-reply-form" data-human-reply="${escapeHtml(child.id)}"><label>人からの回答を記録<textarea required maxlength="8000" rows="3" placeholder="回答内容を入力"></textarea></label><button class="outline-button" type="submit">回答を記録</button></form>`:''}</div>`).join('')||'<p class="project-empty">工程はまだありません。</p>':'<p class="project-empty">工程を読み込んでいます。</p>'}</div><div class="detail-events"><h4>履歴</h4>${events.slice(-state.eventVisibleCount).reverse().map(item=>`<div><time>${formatTime(item.createdAt)}</time><span>${escapeHtml(item.actor)} · ${escapeHtml(item.type)}</span><p>${escapeHtml(item.detail)}</p></div>`).join('')||'<p class="project-empty">履歴を読み込んでいます。</p>'}${detail&&(events.length>state.eventVisibleCount||detail.hasOlderEvents)?'<button id="event-load-more" class="outline-button" type="button">古い履歴をさらに表示</button>':''}</div>` : `<div class="panel-empty tall"><span>⌕</span><strong>詳細を表示する仕事がありません</strong></div>`;
  if(chosen?.status==='completed'&&state.data.user.role!=='viewer')$('mission-detail').querySelector('.mission-actions').insertAdjacentHTML('beforeend','<button id="task-to-playbook" class="outline-button">共有手順の下書きを作る</button>');
  if(chosen?.status==='completed'&&chosen.projectId&&chosen.result?.trim()&&state.data.user.role!=='viewer')$('mission-detail').querySelector('.mission-actions').insertAdjacentHTML('beforeend','<button id="task-to-project-note" class="outline-button">結果を共有ナレッジに残す</button>');
  if(chosen&&['completed','failed','cancelled'].includes(chosen.status)&&['owner','admin'].includes(state.data.user.role)&&state.data.projects.length)$('mission-detail').querySelector('.mission-actions').insertAdjacentHTML('afterend',`<form id="task-project-form" class="task-project-form"><label>所属プロジェクト<select id="task-project-select"><option value="">単発の仕事</option>${state.data.projects.map(project=>`<option value="${escapeHtml(project.id)}" ${project.id===chosen.projectId?'selected':''}>${escapeHtml(project.name)}</option>`).join('')}</select></label><button type="submit" class="outline-button">所属を保存</button></form>`);
  if(detail?.canAcknowledgeFailure)$('mission-detail').querySelector('.mission-actions').insertAdjacentHTML('afterend',`<form class="acknowledge-failure-form"><p>失敗内容を確認して終了すると、未解決の一覧から外れます。失敗の履歴は残ります。</p><label>確認した内容<textarea required maxlength="8000" rows="3" placeholder="失敗の原因と次の対応を入力"></textarea></label><button class="outline-button" type="submit">失敗を確認して終了</button></form>`);
  if(detail) {
    const cards=$('mission-detail').querySelectorAll('.detail-step');
    children.forEach((child,index)=>{if(child.lateReport&&child.lateReport!==child.result)cards[index]?.insertAdjacentHTML('beforeend',`<p>端末から遅れて届いた報告（${child.lateReportSuccess?'成功':'失敗'}）: ${escapeHtml(child.lateReport)}</p>`);});
  }
  if(detail&&['owner','admin'].includes(state.data.user.role)) {
    const cards=$('mission-detail').querySelectorAll('.detail-step');
    children.forEach((child,index)=>{if(child.status==='needs_review'&&['execute','human'].includes(child.kind))cards[index]?.insertAdjacentHTML('beforeend',`<form class="reconcile-form" data-reconcile="${escapeHtml(child.id)}"><label>確認結果<select required><option value="completed">実施済み</option><option value="failed">未実施・失敗</option></select></label><label>確認した内容<textarea required maxlength="8000" rows="3" placeholder="端末や担当者に確認した内容を入力"></textarea></label><button class="outline-button" type="submit">確認結果を記録</button></form>`);});
    children.forEach((child,index)=>{const alternatives=state.data.workers.filter(worker=>worker.connected&&worker.version===state.data.gateway.version&&worker.capabilities?.includes('execution')&&worker.id!==child.assignedDeviceId);if(child.kind==='execute'&&child.status==='ready'&&alternatives.length)cards[index]?.insertAdjacentHTML('beforeend',`<form class="reassign-form" data-reassign="${escapeHtml(child.id)}"><label>担当PCを変更<select required>${alternatives.map(worker=>`<option value="${escapeHtml(worker.id)}">${escapeHtml(worker.name)}</option>`).join('')}</select></label><button class="outline-button" type="submit">未着手の仕事を移す</button></form>`);});
  }
  if($('task-cancel'))$('task-cancel').onclick=async()=>{if(!confirm('この仕事を実行前に中止しますか？'))return;try{await request('/api/tasks/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:chosen.id})});state.taskDetail=null;await refresh();}catch(error){feedback(error.message,true);}};
  if($('task-retry-plan'))$('task-retry-plan').onclick=async()=>{const button=$('task-retry-plan');button.disabled=true;try{await request('/api/tasks/retry-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:chosen.id})});state.taskDetail=null;await refresh();feedback('計画の再実行を依頼しました');}catch(error){feedback(error.message,true);button.disabled=false;}};
  if($('task-reissue'))$('task-reissue').onclick=()=>{$('command-input').value=chosen.text;$('command-project').value=chosen.projectId||'';$('command-input').focus();feedback('内容を確認してから送信してください');};
  if($('task-to-playbook'))$('task-to-playbook').onclick=()=>{if(['playbook-title','playbook-purpose','playbook-prompt'].some(id=>$(id).value.trim())&&!confirm('作成中の共有手順の下書きを置き換えますか？'))return;setView('playbooks');setSkillPane('create');$('playbook-title').value=chosen.text.slice(0,120);$('playbook-purpose').value='';$('playbook-prompt').value=chosen.text.slice(0,8000);$('playbook-feedback').textContent='依頼文を再利用しやすい形に直し、使う場面を入力してから保存してください。';$('playbook-purpose').focus();};
  if($('task-to-project-note'))$('task-to-project-note').onclick=()=>{
    if(($('project-note-title')?.value.trim()||$('project-note-content')?.value.trim())&&!confirm('作成中の共有メモの下書きを置き換えますか？'))return;
    state.selectedProject=chosen.projectId;
    state.projectNotesQuery='';
    setView('projects');
    const title=$('project-note-title'),content=$('project-note-content'),status=$('project-note-status');
    if(!title||!content||!status)return;
    title.value=chosen.text.slice(0,120);
    content.value=chosen.result.slice(0,4000);
    status.textContent=chosen.result.length>4000?'結果が長いため先頭4000文字を入れました。内容を確認してから保存してください。':'内容を確認してから保存してください。';
    content.focus();
  };
  if($('task-project-form'))$('task-project-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button'),projectId=$('task-project-select').value||null;button.disabled=true;try{await request('/api/tasks/project',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:chosen.id,projectId})});state.taskDetail=null;state.projectWorkLoadedAt=0;await refresh();feedback('仕事の所属を更新しました');}catch(error){feedback(error.message,true);button.disabled=false;}};
  document.querySelectorAll('.human-reply-form').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await request('/api/human/respond',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:form.dataset.humanReply,answer:form.querySelector('textarea').value.trim()})});form.querySelector('textarea').blur();state.taskDetail=null;await refresh();}catch(error){feedback(error.message,true);button.disabled=false;}});
  document.querySelectorAll('.reconcile-form').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await request('/api/tasks/reconcile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:form.dataset.reconcile,resolution:form.querySelector('select').value,note:form.querySelector('textarea').value.trim()})});form.querySelector('textarea').blur();state.taskDetail=null;await refresh();}catch(error){feedback(error.message,true);button.disabled=false;}});
  document.querySelectorAll('.acknowledge-failure-form').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await request('/api/tasks/acknowledge-failure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:chosen.id,note:form.querySelector('textarea').value.trim()})});form.querySelector('textarea').blur();state.taskDetail=null;await refresh();feedback('失敗の確認を記録しました');}catch(error){feedback(error.message,true);button.disabled=false;}});
  document.querySelectorAll('.reassign-form').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await request('/api/tasks/reassign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:form.dataset.reassign,deviceId:form.querySelector('select').value})});form.querySelector('select').blur();state.taskDetail=null;await refresh();feedback('未着手の仕事を別のPCへ移しました');}catch(error){feedback(error.message,true);button.disabled=false;}});
  document.querySelectorAll('#mission-list [data-task]').forEach(button=>button.onclick=()=>{state.selectedTask=button.dataset.task;setView('missions');});
  if($('mission-load-more'))$('mission-load-more').onclick=loadMoreTasks;
  if($('event-load-more'))$('event-load-more').onclick=loadMoreEvents;
}
async function loadMoreEvents() {
  const detail=state.taskDetail;
  if(!detail||state.eventsLoading)return;
  if(state.eventVisibleCount<detail.events.length) {state.eventVisibleCount+=30;renderMissions();return;}
  if(!detail.hasOlderEvents)return;
  const oldest=detail.events[0],epoch=state.authEpoch,id=detail.task.id;
  state.eventsLoading=true;
  const button=$('event-load-more');if(button)button.disabled=true;
  try {
    const page=await request(`/api/tasks/events/${id}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({beforeTime:Date.parse(oldest.createdAt),beforeId:oldest.id})});
    if(epoch!==state.authEpoch||state.taskDetail?.task.id!==id)return;
    state.taskDetail.events=[...page.events,...state.taskDetail.events];
    state.taskDetail.hasOlderEvents=page.hasMore;
    state.eventHistoryExpanded=true;
    state.eventVisibleCount+=30;
    renderMissions();
  } catch(error) {if(epoch===state.authEpoch){feedback(error.message,true);if(button.isConnected)button.disabled=false;}}
  finally {if(epoch===state.authEpoch)state.eventsLoading=false;}
}
async function loadMoreTasks() {
  if(state.historyLoading)return;
  const epoch=state.authEpoch;
  const cursor=state.olderTasks.at(-1)||state.data.tasks.at(-1);
  if(!cursor)return;
  state.historyLoading=true;
  const button=$('mission-load-more');if(button)button.disabled=true;
  try {const page=await request('/api/tasks/history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({beforeTime:Date.parse(cursor.createdAt),beforeId:cursor.id})});if(epoch!==state.authEpoch)return;state.olderTasks.push(...page.tasks);state.hasMoreTasks=page.hasMore;renderMissions();}
  catch(error){if(epoch===state.authEpoch){feedback(error.message,true);if(button)button.disabled=false;}}
  finally{if(epoch===state.authEpoch)state.historyLoading=false;}
}
async function loadTaskDetail() {
  const epoch=state.authEpoch;
  const id=state.selectedTask||state.data?.tasks[0]?.id;
  if(!id||state.taskDetailLoading===id)return;
  state.taskDetailLoading=id;
  try {const detail=await request(`/api/tasks/detail/${id}`);if(epoch===state.authEpoch&&(state.selectedTask||state.data?.tasks[0]?.id)===id){
    const previous=state.taskDetail?.task.id===id?state.taskDetail:null;
    if(!previous){state.eventVisibleCount=30;state.eventHistoryExpanded=false;}
    else if(state.eventHistoryExpanded){
      const byId=new Map([...previous.events,...detail.events].map(item=>[item.id,item]));
      detail.events=[...byId.values()].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id.localeCompare(b.id));
      detail.hasOlderEvents=previous.hasOlderEvents;
    }
    state.taskDetail=detail;renderMissions();}}
  catch(error){if(epoch===state.authEpoch)feedback(error.message,true);}
  finally{if(epoch===state.authEpoch&&state.taskDetailLoading===id)state.taskDetailLoading=null;}
}
function renderProjects() {
  const previousProject=$('project-detail').querySelector('[data-project-id]')?.dataset.projectId;
  const draftTitle=$('project-note-title')?.value||'',draftContent=$('project-note-content')?.value||'',draftStatus=$('project-note-status')?.textContent||'';
  const draftWorkQuery=$('project-work-search')?.value??state.projectWorkQuery;
  const projects=state.data.projects||[];
  if(projects.length&&!projects.some(project=>project.id===state.selectedProject))state.selectedProject=projects[0].id;
  const select=$('command-project'),selected=select.value;
  select.innerHTML='<option value="">単発の依頼</option>'+projects.filter(project=>project.status==='active').map(project=>`<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('');
  select.value=projects.some(project=>project.id===selected&&project.status==='active')?selected:'';
  $('project-form').classList.toggle('hidden',!['owner','admin'].includes(state.data.user.role));
  $('project-total').textContent=`${String(projects.length).padStart(2,'0')} PROJECTS`;
  $('project-list').innerHTML=projects.length?projects.map(project=>`<button class="project-row ${state.selectedProject===project.id?'selected':''}" data-project="${escapeHtml(project.id)}"><span class="project-glyph">◈</span><span><strong>${escapeHtml(project.name)}</strong><small>${project.completed}/${project.total}件完了 · ${project.status==='active'?'稼働中':project.status==='paused'?'保留':'完了'}</small></span><em>${project.total?Math.round(project.completed/project.total*100):0}%</em></button>`).join(''):'<div class="panel-empty tall"><span>◈</span><strong>プロジェクトはまだありません</strong><small>目的を設定すると、複数の依頼をまとめて追跡できます。</small></div>';
  const project=projects.find(item=>item.id===state.selectedProject)||projects[0];
  const work=project&&state.projectWork?.project.id===project.id&&(state.projectWork.query||'')===state.projectWorkQuery?state.projectWork:null;
  const tasks=work?.tasks||[];
  const workMarkup=work?(tasks.length?tasks.map(task=>`<button class="project-task" data-project-task="${escapeHtml(task.id)}"><span>${escapeHtml(task.text)}</span><em>${escapeHtml(labels[task.status]||task.status)}</em></button>`).join(''):`<p class="project-empty">${state.projectWorkQuery?'一致する仕事はありません':'このプロジェクトの仕事はまだありません。'}</p>`)+(work.remaining?`<p class="project-empty">${state.projectWorkQuery?'ほかの一致する仕事':'古い仕事'}が${work.remaining}件あります。</p>`:''):'<p class="project-empty">仕事を読み込み中…</p>';
  const workSearchMarkup=`<form id="project-work-search-form" class="project-work-search"><label>仕事を検索<input id="project-work-search" maxlength="100" value="${escapeHtml(state.projectWorkQuery)}" placeholder="依頼・結果・失敗内容"></label><button type="submit" class="outline-button">検索</button>${state.projectWorkQuery?'<button id="project-work-search-clear" type="button" class="outline-button">解除</button>':''}</form>`;
  $('project-detail').innerHTML=project?`<div class="project-detail-inner" data-project-id="${escapeHtml(project.id)}"><span class="overline">PROJECT / ${escapeHtml(project.id.slice(0,8).toUpperCase())}</span><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.objective)}</p><div class="project-progress"><span style="width:${project.total?Math.round(project.completed/project.total*100):0}%"></span></div><div class="project-stats"><span>${project.total}件の依頼</span><span>${project.completed}件完了</span><span>${project.failed}件失敗</span><span>${project.attention}件要確認</span></div><div class="project-share"><button id="project-share" type="button" class="outline-button">進捗メモをコピー ↗</button><span id="project-share-status" role="status"></span></div>${['owner','admin'].includes(state.data.user.role)?`<label class="project-status-label">状態 <select id="project-status"><option value="active" ${project.status==='active'?'selected':''}>稼働中</option><option value="paused" ${project.status==='paused'?'selected':''}>保留</option><option value="completed" ${project.status==='completed'?'selected':''}>完了</option></select></label>`:''}${projectNotesMarkup(project)}<h4>仕事の履歴</h4>${workSearchMarkup}${workMarkup}${project.status==='active'?'<button id="project-assign" class="outline-button">このプロジェクトでレイに依頼 ↗</button>':''}</div>`:'<div class="panel-empty tall"><span>◇</span><strong>プロジェクトを選択</strong></div>';
  if(project?.id===previousProject&&$('project-note-title')){$('project-note-title').value=draftTitle;$('project-note-content').value=draftContent;$('project-note-status').textContent=draftStatus;$('project-work-search').value=draftWorkQuery;}
  document.querySelectorAll('[data-project]').forEach(button=>button.onclick=()=>{state.selectedProject=button.dataset.project;state.projectNotesQuery='';state.projectWorkQuery='';renderProjects();void loadProjectNotes();void loadProjectWork();});
  document.querySelectorAll('[data-project-task]').forEach(button=>button.onclick=()=>{state.selectedTask=button.dataset.projectTask;setView('missions');});
  if($('project-assign'))$('project-assign').onclick=()=>{select.value=project.id;$('command-input').focus();};
  if($('project-share'))$('project-share').onclick=async()=>{
    const button=$('project-share'),status=$('project-share-status');button.disabled=true;status.textContent='メモを作成中…';
    try {const brief=await request(`/api/projects/brief/${project.id}`);await navigator.clipboard.writeText(projectBriefText(brief));if(state.selectedProject===project.id)status.textContent='コピーしました';}
    catch(error){if(state.selectedProject===project.id)status.textContent=`コピーできませんでした：${error.message}`;}
    finally{button.disabled=false;}
  };
  if($('project-note-form'))$('project-note-form').onsubmit=async event=>{
    event.preventDefault();const button=event.target.querySelector('[type="submit"]'),status=$('project-note-status');button.disabled=true;status.textContent='保存中…';
    try{await request('/api/projects/notes/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:project.id,title:$('project-note-title').value.trim(),content:$('project-note-content').value.trim()})});if(state.selectedProject===project.id){event.target.reset();state.projectNotes=null;await loadProjectNotes();$('project-note-status').textContent='共有メモを保存しました';}}
    catch(error){if(state.selectedProject===project.id)status.textContent=error.message;}
    finally{button.disabled=false;}
  };
  document.querySelectorAll('[data-note-to-playbook]').forEach(button=>button.onclick=()=>{
    const note=state.projectNotes?.projectId===project.id?state.projectNotes.notes.find(item=>item.id===button.dataset.noteToPlaybook):null;
    if(!note)return;
    if(['playbook-title','playbook-purpose','playbook-prompt'].some(id=>$(id).value.trim())&&!confirm('作成中の共有手順の下書きを置き換えますか？'))return;
    setView('playbooks');
    setSkillPane('create');
    $('playbook-title').value=note.title.slice(0,120);
    $('playbook-purpose').value='';
    $('playbook-prompt').value=note.content.slice(0,8000);
    $('playbook-feedback').textContent='共有ナレッジを再利用できる依頼文に書き直し、使う場面を入力してから保存してください。';
    $('playbook-purpose').focus();
  });
  if($('project-note-search-form'))$('project-note-search-form').onsubmit=event=>{event.preventDefault();state.projectNotesQuery=$('project-note-search').value.trim();if(!state.projectNotesQuery)return;void loadProjectNotes();};
  if($('project-note-search-clear'))$('project-note-search-clear').onclick=()=>{state.projectNotesQuery='';void loadProjectNotes();};
  if($('project-work-search-form'))$('project-work-search-form').onsubmit=event=>{event.preventDefault();state.projectWorkQuery=$('project-work-search').value.trim();if(!state.projectWorkQuery)return;void loadProjectWork();};
  if($('project-work-search-clear'))$('project-work-search-clear').onclick=()=>{state.projectWorkQuery='';$('project-work-search').value='';void loadProjectWork();};
  if($('project-status'))$('project-status').onchange=async event=>{const value=event.target.value;try{await request('/api/projects/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:project.id,status:value})});await refresh();}catch(error){$('project-feedback').textContent=error.message;await refresh();}};
}
function projectNotesMarkup(project){
  const data=state.projectNotes?.projectId===project.id?state.projectNotes:null;
  const notes=data?.notes||[];
  return `<section class="project-notes"><h4>共有ナレッジ</h4><p class="project-empty">このプロジェクトの決定事項・手順・引き継ぎ情報を残せます。</p><form id="project-note-search-form" class="project-note-search"><label>共有メモを検索<input id="project-note-search" maxlength="100" value="${escapeHtml(state.projectNotesQuery)}" placeholder="件名・内容・作成者"></label><button type="submit" class="outline-button">検索</button>${state.projectNotesQuery?'<button id="project-note-search-clear" type="button" class="outline-button">解除</button>':''}</form>${data?notes.length?notes.map(note=>`<article class="project-note"><strong>${escapeHtml(note.title)}</strong><small>${escapeHtml(note.author)} · ${formatTime(note.createdAt)}</small><p>${escapeHtml(note.content)}</p>${state.data.user.role==='viewer'?'':`<button type="button" class="outline-button" data-note-to-playbook="${escapeHtml(note.id)}">共有手順の下書きへ ↗</button>`}</article>`).join(''):`<p class="project-empty">${state.projectNotesQuery?'一致する共有メモはありません':'共有メモはまだありません。'}</p>`:'<p class="project-empty">共有メモを読み込み中…</p>'}${data?.remaining?`<p class="project-empty">${state.projectNotesQuery?'ほかの一致する共有メモ':'古い共有メモ'}が${data.remaining}件あります。</p>`:''}${state.data.user.role==='viewer'?'':`<form id="project-note-form"><label>件名<input id="project-note-title" required maxlength="120" placeholder="例：LP公開までの手順"></label><label>共有する内容<textarea id="project-note-content" required maxlength="4000" rows="3" placeholder="決定事項や再利用できる手順を記入"></textarea></label><button type="submit" class="outline-button">共有メモを保存 ↗</button><span id="project-note-status" role="status"></span></form>`}</section>`;
}
async function loadProjectNotes(){
  const id=state.selectedProject,epoch=state.authEpoch,query=state.projectNotesQuery,sequence=++state.projectNotesRequest;if(!id||state.projectNotes?.projectId===id&&(state.projectNotes.query||'')===query)return;
  state.projectNotesLoading=true;
  try{const data=query?await request('/api/projects/notes/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:id,query})}):await request(`/api/projects/notes/${id}`);if(epoch!==state.authEpoch||sequence!==state.projectNotesRequest)return;state.projectNotes={...data,query};renderProjects();}
  catch(error){if(epoch===state.authEpoch&&sequence===state.projectNotesRequest){const status=$('project-feedback');if(status)status.textContent=error.message;}}
  finally{if(epoch===state.authEpoch&&sequence===state.projectNotesRequest)state.projectNotesLoading=false;}
}
async function loadProjectWork(){
  const id=state.selectedProject,epoch=state.authEpoch;
  const current=state.data?.projects.find(project=>project.id===id);
  const cached=state.projectWork?.project;
  if(!id||cached?.id===id&&(state.projectWork?.query||'')===state.projectWorkQuery&&cached.total===current?.total&&cached.completed===current?.completed&&cached.failed===current?.failed&&cached.attention===current?.attention&&Date.now()-state.projectWorkLoadedAt<30000)return;
  const sequence=++state.projectWorkRequest;
  try{const query=state.projectWorkQuery,data=query?await request('/api/projects/tasks/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:id,query})}):await request(`/api/projects/brief/${id}`);if(epoch!==state.authEpoch||sequence!==state.projectWorkRequest||state.selectedProject!==id||query!==state.projectWorkQuery)return;state.projectWork=data;state.projectWorkLoadedAt=Date.now();renderProjects();}
  catch(error){if(epoch===state.authEpoch&&sequence===state.projectWorkRequest){state.projectWorkLoadedAt=Date.now();const status=$('project-feedback');if(status)status.textContent=error.message;}}
}
function projectBriefText({project,tasks,remaining,notes=[],generatedAt}) {
  const status={active:'稼働中',paused:'保留',completed:'完了'}[project.status]||project.status;
  const lines=[`REI プロジェクト進捗メモ：${project.name}`,`作成日時：${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(generatedAt))}`,`状態：${status}`,`目的：${project.objective}`,`進捗：全${project.total}件 / 完了${project.completed}件 / 失敗${project.failed}件 / 要確認${project.attention}件`,'','最近の仕事'];
  if(!tasks.length)lines.push('・まだ仕事の記録はありません');
  for(const task of tasks){lines.push(`・[${labels[task.status]||task.status}] ${task.text}`);const result=(task.result||task.error||'').trim();if(result)lines.push(`  結果：${result.replace(/\s+/g,' ').slice(0,240)}`);}
  if(remaining)lines.push(`・このほか${remaining}件の仕事があります。詳細はREIのプロジェクト画面で確認してください。`);
  lines.push('','共有ナレッジ');
  if(!notes.length)lines.push('・まだ共有メモはありません');
  for(const note of notes)lines.push(`・${note.title}（${note.author}）：${note.content.replace(/\s+/g,' ').slice(0,400)}`);
  lines.push('','※ このREI Hubに登録された仕事だけを記載しています。');
  return lines.join('\n');
}
function renderPlaybooks(){
  const items=state.playbooks?.playbooks||[];
  $('playbook-total').textContent=`${String(items.length).padStart(2,'0')} ${state.playbookQuery||state.playbookDepartment!=='all'?'MATCHES':'SKILLS'}`;
  setSkillPane(state.skillPane);
  if(items.length&&!items.some(item=>item.id===state.selectedPlaybook))state.selectedPlaybook=items[0].id;
  $('playbook-list').innerHTML=items.length?items.map(item=>`<button type="button" class="playbook-row ${item.id===state.selectedPlaybook?'selected':''}" data-playbook="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(departmentName(item.department))} · ${escapeHtml(item.purpose)}</small><em>${escapeHtml(item.author)} · ${formatTime(item.createdAt)}</em></button>`).join('')+(state.playbooks.remaining?`<p class="project-empty">ほかのスキルが${state.playbooks.remaining}件あります。検索で探してください。</p>`:''):state.playbooks?`<div class="panel-empty tall"><strong>${state.playbookQuery||state.playbookDepartment!=='all'?'一致するスキルはありません':'社内スキルはまだありません'}</strong><small>${state.playbookQuery?'別の言葉で検索してください。':'成功した仕事の手順を登録できます。'}</small></div>`:'<div class="panel-empty tall"><strong>スキルを読み込み中…</strong></div>';
  const item=items.find(value=>value.id===state.selectedPlaybook);
  $('playbook-detail').innerHTML=item?`<div class="playbook-detail-inner"><span class="overline">${escapeHtml(departmentName(item.department))} · ${escapeHtml(item.author)} · ${formatTime(item.createdAt)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.purpose)}</p><h4>実施手順</h4><pre>${escapeHtml(item.prompt)}</pre>${item.knowledge?`<h4>参考知識・注意点</h4><pre>${escapeHtml(item.knowledge)}</pre>`:''}<button type="button" class="outline-button" id="playbook-use">このスキルで依頼 ↗</button><p class="project-empty">依頼文を確認・編集してから送信してください。</p></div>`:'<div class="panel-empty tall"><strong>スキルを選択</strong></div>';
  document.querySelectorAll('[data-playbook]').forEach(button=>button.onclick=()=>{state.selectedPlaybook=button.dataset.playbook;renderPlaybooks();});
  if($('playbook-use'))$('playbook-use').onclick=()=>{$('command-input').value=item.prompt;if(item.department!=='all')state.selectedDepartment=item.department;commandSkill(item);$('command-input').focus();feedback('スキルを選びました。依頼文を確認して送信してください。');};
}
async function loadPlaybooks(){
  const epoch=state.authEpoch,sequence=++state.playbooksRequest,query=state.playbookQuery,department=state.playbookDepartment;state.playbooksLoading=true;
  try{const data=query||department!=='all'?await request('/api/playbooks/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,department})}):await request('/api/playbooks');if(epoch!==state.authEpoch||sequence!==state.playbooksRequest)return;state.playbooks=data;state.selectedPlaybook=null;renderPlaybooks();}
  catch(error){if(epoch===state.authEpoch&&sequence===state.playbooksRequest)$('playbook-feedback').textContent=error.message;}
  finally{if(epoch===state.authEpoch&&sequence===state.playbooksRequest)state.playbooksLoading=false;}
}
async function loadReport(silent=false) {
  if(state.reportLoading)return;
  const epoch=state.authEpoch;
  state.reportLoading=true;
  $('report-copy-status').textContent='';
  if(!silent)$('briefing-content').innerHTML = '<div class="glass-panel loading">実行記録を照合しています...</div>';
  try { const report=await request('/api/report/today'); if(epoch!==state.authEpoch)return; state.report=report; state.reportLoadedAt=Date.now(); renderBriefing(); }
  catch (error) { if(epoch!==state.authEpoch)return; state.reportLoadedAt=Date.now(); if(!silent||!state.report)$('briefing-content').innerHTML = `<div class="glass-panel loading">${escapeHtml(error.message)}</div>`; }
  finally {if(epoch===state.authEpoch)state.reportLoading=false;}
}
function reportText(report,units) {
  const backlog=report.attentionBacklog||{total:0,tasks:[]};
  const approvals=report.approvalBacklog||{total:0,tasks:[]};
  const lines=[`REI 今日の稼働報告（${report.day}）`,`登録端末 ${units.length}台 / 接続中 ${units.filter(unit=>unit.connected).length}台`,`本日の仕事 ${report.total}件：完了 ${report.completed}件、進行中 ${report.running}件、失敗 ${report.failed}件、要確認 ${report.interrupted}件、承認待ち ${report.approvalPending||0}件`,`前日以前からの要確認 ${backlog.total}件 / 承認待ち ${approvals.total}件`,'', 'PC・人の稼働'];
  for(const device of (report.devices||[]).filter(item=>!item.revoked||item.total))lines.push(`・${device.label}: ${device.total}工程、完了${device.completed}、実行中${device.running}、失敗${device.failed}、要確認${device.attention}`);
  if(report.people?.total)lines.push(`・人への依頼: ${report.people.total}件、回答${report.people.completed}、待機${report.people.waiting}、要確認${report.people.attention}`);
  if(backlog.total){lines.push('','前日以前から残る要確認');for(const task of backlog.tasks)lines.push(`・[${task.projectName||'単発'}] ${task.text}${task.summary?` — ${task.summary}`:''}`);if(backlog.total>backlog.tasks.length)lines.push(`・ほか${backlog.total-backlog.tasks.length}件はREIの画面で確認`);}
  if(approvals.total){lines.push('','前日以前から残る承認待ち');for(const task of approvals.tasks)lines.push(`・[${task.projectName||'単発'}] ${task.text}`);if(approvals.total>approvals.tasks.length)lines.push(`・ほか${approvals.total-approvals.tasks.length}件はREIの画面で確認`);}
  lines.push('','本日の仕事');
  if(!report.tasks.length)lines.push('・記録なし');
  for(const task of report.tasks)lines.push(`・[${labels[task.status]||task.status}・${task.projectName||'単発'}] ${task.text}${task.summary?` — ${task.summary}`:''}`);
  lines.push('','※ このREI Hubに登録された仕事のみを集計。端末の他用途の活動は含みません。');
  return lines.join('\n');
}
function renderBriefing() {
  if (!state.report) return;
  $('report-copy').disabled=false;
  const report = state.report;
  const units=state.data?.workers||[];
  const connected=units.filter(unit=>unit.connected).length;
  const rows=(report.devices||[]).filter(device=>!device.revoked||device.total).map(device=>{const unit=units.find(item=>item.id===device.id);return `<li>${escapeHtml(device.label)} <b>${device.total}工程 / 完了${device.completed} / 実行中${device.running} / 失敗${device.failed} / 要確認${device.attention} · ${unit?.connected?'接続中':'未接続'}</b></li>`;}).join('');
  const people=report.people?.total?`<li>人への依頼 <b>${report.people.total}件 / 回答${report.people.completed} / 待機${report.people.waiting} / 要確認${report.people.attention}</b></li>`:'';
  const backlog=report.attentionBacklog||{total:0,tasks:[]};
  const backlogPanel=backlog.total?`<div class="glass-panel briefing-tasks"><div class="panel-heading"><span>未解決の仕事 / EARLIER DAYS</span><span>${backlog.total}件${backlog.total>backlog.tasks.length?`・新しい${backlog.tasks.length}件を表示`:''}</span></div>${backlog.tasks.map(task=>`<button type="button" class="brief-task backlog-task" data-backlog-task="${escapeHtml(task.id)}"><span class="status needs_review">要確認</span><div><strong>${escapeHtml(task.text)}</strong><small>${escapeHtml(task.projectName||"単発")} · ${escapeHtml(task.summary)}</small></div><span>${formatTime(task.activityAt)}</span></button>`).join('')}</div>`:'';
  const approvals=report.approvalBacklog||{total:0,tasks:[]};
  const approvalPanel=approvals.total?`<div class="glass-panel briefing-tasks"><div class="panel-heading"><span>承認待ち / EARLIER DAYS</span><span>${approvals.total}件${approvals.total>approvals.tasks.length?`・新しい${approvals.tasks.length}件を表示`:''}</span></div>${approvals.tasks.map(task=>`<button type="button" class="brief-task backlog-task" data-backlog-task="${escapeHtml(task.id)}"><span class="status approval_pending">承認待ち</span><div><strong>${escapeHtml(task.text)}</strong><small>${escapeHtml(task.projectName||'単発')}</small></div><span>${formatTime(task.activityAt)}</span></button>`).join('')}</div>`:'';
  $('briefing-content').innerHTML = `<div class="brief-grid"><div class="glass-panel briefing-lead"><span>BRIEFING / ${escapeHtml(report.day)}</span><h3>本日の稼働状況</h3><p>REIに登録された端末は <b>${units.length}台</b>、現在接続中は <b>${connected}台</b>。本日の記録は <b>${report.total}件</b>です。</p><div class="brief-stats"><div><small>COMPLETED</small><strong>${report.completed}</strong><span>完了</span></div><div><small>IN PROGRESS</small><strong>${report.running}</strong><span>進行中</span></div><div><small>NEEDS ATTENTION</small><strong>${report.interrupted+backlog.total+(report.approvalPending||0)+approvals.total}</strong><span>要確認${report.interrupted+backlog.total} / 承認待ち${(report.approvalPending||0)+approvals.total}</span></div></div>${report.failed?`<p>本日失敗で終了した仕事: ${report.failed}件</p>`:''}</div><div class="glass-panel briefing-scope"><span>DATA SCOPE</span><h3>PC・人の稼働</h3><p>このREI Hubで記録した仕事だけを集計しています。端末の他用途の活動は含みません。</p><ul>${rows||'<li>登録端末なし</li>'}${people}</ul></div></div>${approvalPanel}${backlogPanel}<div class="glass-panel briefing-tasks"><div class="panel-heading"><span>RECORDED MISSIONS</span><span>${report.total} ENTRIES</span></div>${report.tasks.length?report.tasks.map(task=>`<button type="button" class="brief-task backlog-task" data-backlog-task="${escapeHtml(task.id)}"><span class="status ${escapeHtml(task.status)}">${escapeHtml(labels[task.status]||task.status)}</span><div><strong>${escapeHtml(task.text)}</strong><small>${escapeHtml(task.projectName||"単発")} · ${escapeHtml(task.summary)}</small></div><span>${formatTime(task.activityAt||task.createdAt)}</span></button>`).join(''):'<div class="panel-empty"><strong>今日の仕事はまだありません</strong></div>'}</div>`;
  document.querySelectorAll('[data-backlog-task]').forEach(button=>button.onclick=()=>{state.selectedTask=button.dataset.backlogTask;state.taskDetail=null;setView('missions');});
}
document.querySelectorAll('.rail-btn').forEach(button => button.onclick = () => setView(button.dataset.view));
$('refresh').onclick = refresh;
$('report-refresh').onclick = loadReport;
$('report-copy').onclick=async()=>{if(!state.report)return;try{await navigator.clipboard.writeText(reportText(state.report,state.data?.workers||[]));$('report-copy-status').textContent='コピーしました';}catch{$('report-copy-status').textContent='コピーできませんでした。ブラウザのクリップボード許可を確認してください。';}};
$('project-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('[type="submit"]');button.disabled=true;$('project-feedback').textContent='';try{const result=await request('/api/projects/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('project-name').value.trim(),objective:$('project-objective').value.trim()})});$('project-name').value='';$('project-objective').value='';state.selectedProject=result.project.id;state.projectNotes=null;await refresh();void loadProjectNotes();$('command-project').value=result.project.id;$('project-feedback').textContent='プロジェクトを作成しました';}catch(error){$('project-feedback').textContent=error.message;}finally{button.disabled=false;}};
document.querySelectorAll('[data-skill-pane]').forEach(button=>button.onclick=()=>setSkillPane(button.dataset.skillPane));
$('playbook-search-form').onsubmit=event=>{event.preventDefault();state.playbookQuery=$('playbook-search').value.trim();state.playbookDepartment=$('playbook-department').value;$('playbook-feedback').textContent='';void loadPlaybooks();};
$('playbook-search-clear').onclick=()=>{$('playbook-search').value='';$('playbook-department').value='all';state.playbookQuery='';state.playbookDepartment='all';$('playbook-feedback').textContent='';void loadPlaybooks();};
$('playbook-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('[type="submit"]');button.disabled=true;$('playbook-feedback').textContent='';try{const result=await request('/api/playbooks/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:$('playbook-title').value.trim(),purpose:$('playbook-purpose').value.trim(),prompt:$('playbook-prompt').value.trim(),knowledge:$('playbook-knowledge').value.trim(),department:$('playbook-create-department').value})});event.target.reset();state.playbookQuery='';state.playbookDepartment='all';$('playbook-search').value='';$('playbook-department').value='all';await loadPlaybooks();state.selectedPlaybook=result.playbook.id;setSkillPane('library');renderPlaybooks();$('playbook-feedback').textContent='スキルを保存しました';}catch(error){$('playbook-feedback').textContent=error.message;}finally{button.disabled=false;}};
$('marketplace-search-form').onsubmit=async event=>{event.preventDefault();const query=$('marketplace-search').value.trim(),button=event.target.querySelector('button');if(!query)return;button.disabled=true;$('marketplace-results').textContent='マーケットプレイスを検索中…';try{const result=await request('/api/skills/marketplace/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query})});$('marketplace-results').innerHTML=result.results.length?result.results.map(item=>`<article class="marketplace-result"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.owner)} · ${item.official?'公式':'外部作成者'} · ${escapeHtml(item.installability)}</small><p>${escapeHtml(item.summary)}</p><code>${escapeHtml(item.reference)}</code>${item.url?`<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">内容を確認 ↗</a>`:''}</article>`).join(''):'一致する候補はありません。';}catch(error){$('marketplace-results').textContent=error.message;}finally{button.disabled=false;}};
$('command-skill').onclick=()=>{commandSkill(null);feedback('使用スキルの指定を解除しました');};
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
    const result = await request('/api/command', { method:'POST', headers:{ 'Content-Type':'application/json', 'X-AI-Company':'1' }, body:JSON.stringify({ text, department:state.selectedDepartment || 'operations', projectId:$('command-project').value||null,skillId:state.selectedCommandSkill?.id||null }) });
    input.value = '';
    commandSkill(null);
    await refresh();
    if (result.kind === 'report') { state.report = result.report; state.reportLoadedAt=Date.now(); setView('briefing'); feedback('DAILY BRIEFING READY'); }
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
  state.authEpoch++;
  const epoch=state.authEpoch;
  state.data=null;
  state.taskDetail=null;
  state.taskDetailLoading=null;
  state.eventVisibleCount=30;
  state.eventHistoryExpanded=false;
  state.eventsLoading=false;
  state.olderTasks=[];
  state.hasMoreTasks=false;
  state.historyLoading=false;
  state.selectedTask=null;
  state.selectedProject=null;
  state.projectWork=null;
  state.projectWorkLoadedAt=0;
  state.projectWorkRequest++;
  state.projectWorkQuery='';
  state.projectNotes=null;
  state.projectNotesLoading=false;
  state.projectNotesQuery='';
  state.projectNotesRequest++;
  state.playbooks=null;
  state.playbooksLoading=false;
  state.playbookQuery='';
  state.playbookDepartment='all';
  state.skillPane='library';
  state.playbooksRequest++;
  $('playbook-search').value='';
  $('playbook-department').value='all';
  state.selectedPlaybook=null;
  commandSkill(null);
  $('marketplace-results').replaceChildren();
  state.selectedDepartment=null;
  state.pendingReplyTaskId=null;
  state.report=null;
  state.reportLoadedAt=0;
  state.reportLoading=false;
  $('report-copy').disabled=true;
  $('report-copy-status').textContent='';
  state.mcpIntegrations=[];
  for(const id of ['mission-feed','system-signals','unit-list','focus-content','mission-list','mission-detail','project-list','project-detail','briefing-content','approval-management','device-management','mcp-management','chatwork-status','signed-in-user','pairing-result','enroll-result','invite-result','backup-result','user-management','local-setup','settings-feedback'])$(id)?.replaceChildren();
  for(const id of ['pairing-result','enroll-result','invite-result'])$(id).classList.add('hidden');
  $('command-input').value='';
  document.querySelectorAll('input[type="password"],textarea').forEach(input=>input.value='');
  setView('core');
  $('settings-screen').classList.add('hidden');
  $('system-status').textContent='LOGIN REQUIRED';
  $('system-status').classList.add('offline');
  $('agent-count').textContent='00';
  $('running-count').textContent='00';
  $('auth-screen').classList.remove('hidden');
  $('auth-title').textContent = setupToken ? 'レイの初期登録' : 'レイにログイン';
  $('auth-help').textContent = setupToken ? '所有者のユーザー名とパスワードを設定してください。' : 'あなたの司令室に入ります。';
  $('auth-form').dataset.mode = setupToken ? 'setup' : 'login';
  $('auth-password').autocomplete = setupToken ? 'new-password' : 'current-password';
  if(!setupToken)void fetch('/api?route=setup%2Fstatus').then(response=>response.ok?response.json():null).then(status=>{
    if(epoch===state.authEpoch&&status?.needsSetup)$('auth-help').textContent='初回登録が必要です。REIを起動したターミナルに表示された「REIの初期登録」URLを開いてください。';
  }).catch(()=>{});
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
  const epoch=state.authEpoch;
  const role=state.data.user.role;
  const canManage=['owner','admin'].includes(role);
  $('signed-in-user').textContent = `${state.data.user.username} / ${{owner:'所有者',admin:'管理者',requester:'依頼者',viewer:'閲覧者'}[role]||role}`;
  $('backup-create').classList.toggle('hidden',role!=='owner');
  $('invite-form').classList.toggle('hidden',!canManage);
  $('pairing-form').classList.toggle('hidden',!canManage);
  $('enroll-form').classList.toggle('hidden',!canManage);
  $('chatwork-form').classList.toggle('hidden',role!=='owner');
  networkPanel.classList.toggle('hidden',!canManage);
  $('invite-role').querySelector('option[value="admin"]').disabled=role!=='owner';
  if(role!=='owner'&&$('invite-role').value==='admin')$('invite-role').value='requester';
  if(!$('user-management')){const panel=document.createElement('div');panel.id='user-management';$('invite-form').before(panel);}
  if(canManage){
    try {
      const {users}=await request('/api/users/list');
      if(epoch!==state.authEpoch)return;
      $('user-management').innerHTML=users.map(member=>`<div class="setting-device"><span><b>${escapeHtml(member.username)}</b><small>${member.disabled?'停止中 · ':''}${{owner:'所有者',admin:'管理者',requester:'依頼者',viewer:'閲覧者'}[member.role]||member.role}</small></span>${role==='owner'&&member.role!=='owner'?`<span class="user-controls"><select data-user-role="${escapeHtml(member.id)}" aria-label="${escapeHtml(member.username)}の権限"><option value="admin" ${member.role==='admin'?'selected':''}>管理者</option><option value="requester" ${member.role==='requester'?'selected':''}>依頼者</option><option value="viewer" ${member.role==='viewer'?'selected':''}>閲覧者</option></select><button data-user-disable="${escapeHtml(member.id)}" data-disabled="${member.disabled?'1':'0'}" class="outline-button">${member.disabled?'再開':'停止'}</button></span>`:''}</div>`).join('');
      document.querySelectorAll('[data-user-role]').forEach(select=>select.onchange=async()=>{try{await request('/api/users/role',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:select.dataset.userRole,role:select.value})});await refreshSettings();}catch(e){$('settings-feedback').textContent=e.message;await refreshSettings();}});
      document.querySelectorAll('[data-user-disable]').forEach(button=>button.onclick=async()=>{const disabled=button.dataset.disabled!=='1';if(disabled&&!confirm('この利用者を停止し、現在のログインを解除しますか？'))return;try{await request('/api/users/disable',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:button.dataset.userDisable,disabled})});await refreshSettings();}catch(e){$('settings-feedback').textContent=e.message;}});
    }catch(e){if(epoch!==state.authEpoch)return;$('user-management').textContent=e.message;}
  }else $('user-management').textContent='利用者の管理は管理者が行います。';
  const pending=state.data.tasks.filter(task=>task.status==='approval_pending');
  $('approval-management').innerHTML=!canManage?'<p>承認は管理者が行います。</p>':pending.length?pending.map(task=>`<div class="setting-device"><span><b>${escapeHtml(task.text)}</b><small>依頼者の仕事</small></span><span><button data-approve="${escapeHtml(task.id)}" class="outline-button">承認</button><button data-reject="${escapeHtml(task.id)}" class="outline-button">却下</button></span></div>`).join(''):'<p>承認待ちはありません。</p>';
  document.querySelectorAll('[data-approve],[data-reject]').forEach(button=>button.onclick=async()=>{const route=button.dataset.approve?'approve':'reject',taskId=button.dataset.approve||button.dataset.reject;try{await request(`/api/tasks/${route}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId})});await refresh();await refreshSettings();}catch(e){$('settings-feedback').textContent=e.message;}});
  try {
    const [devices,chatwork,mcp] = await Promise.all([request('/api/devices'),request('/api/chatwork/status'),request('/api/mcp/list')]);
    if(epoch!==state.authEpoch)return;
    if(!$('local-setup')){const panel=document.createElement('div');panel.id='local-setup';panel.className='setting-guide';$('device-management').before(panel);}
    const local=devices.localConnector;
    if(local?.status==='registered')$('local-setup').textContent=local.online?'✓ このPCのOpenClawはREIに接続中です。':'このPCは登録済みですが未接続です。REIのフォルダで npm run connector を実行してください。';
    else if(local?.status==='needs_attention')$('local-setup').textContent='このPCに以前の接続設定があります。上書きせず、端末の接続設定を確認してください。';
    else if(canManage) {
      $('local-setup').innerHTML=`<strong>このPCのOpenClawをREIへ接続</strong><p>最初の1台は、ここから始められます。既存のOpenClawとは別にREI専用エージェントを作ります。</p>${devices.bundledMac&&role==='owner'?'<button id="local-connect" class="outline-button" type="button">このMacを接続する</button>':''}<button id="local-pair" class="outline-button" type="button">開発用の接続コードを作る</button><div id="local-pair-result" class="secret-result hidden"></div>`;
      if($('local-connect'))$('local-connect').onclick=async()=>{const button=$('local-connect');button.disabled=true;$('settings-feedback').textContent='このMacのREI担当AIを準備しています…';try{await request('/api/devices/local-connect',{method:'POST'});$('settings-feedback').textContent='このMacを接続しました。端末の状態を更新してください。';await refreshSettings();}catch(error){$('settings-feedback').textContent=error.message;button.disabled=false;}};
      $('local-pair').onclick=async()=>{const button=$('local-pair');button.disabled=true;try{const paired=await request('/api/devices/pairing',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:'このPC'})});const result=$('local-pair-result'),command=`node connector.mjs join ${location.origin}`;result.classList.remove('hidden');result.textContent=`このPCのREIフォルダで実行:\n${command}\n\n質問されたら接続コードを入力（10分間有効）:\n${paired.code}\n\n接続後、端末の状態を更新してください。`;addCopyActions(result,[['コマンドをコピー',command],['接続コードをコピー',paired.code]]);button.disabled=false;}catch(error){$('settings-feedback').textContent=error.message;button.disabled=false;}};
    } else $('local-setup').textContent='このPCの接続設定は所有者または管理者が行えます。';
    $('device-management').innerHTML = devices.devices.length ? devices.devices.map(d=>`<div class="setting-device"><span><b>${escapeHtml(d.label)}</b><small>${d.online?'● 接続中':'○ 未接続'}${d.planner?' · REI計画担当':''}${d.agent_name?` · OpenClaw: ${escapeHtml(d.agent_name)}`:''} · REI ${escapeHtml(d.version||'版未報告')}${d.version!==devices.hubVersion?' · 更新が必要':''}${d.pending_results?` · 結果送信待ち ${d.pending_results}件。端末の接続と仕事の状態を確認してください`:''}</small></span>${canManage?`<button data-revoke="${escapeHtml(d.id)}" class="outline-button">解除</button>`:''}</div>`).join('') : '<p>端末はまだ登録されていません。</p>';
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
    $('chatwork-status').textContent = chatwork.needsAttention ? '要確認 · 暗号鍵と設定を確認してください' : chatwork.configured ? `接続設定済み · ルーム ${chatwork.roomId} · 人待ち ${chatwork.pending}件` : '未設定';
  } catch(e) {if(epoch===state.authEpoch)$('settings-feedback').textContent=e.message;}
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
const pairingGuide=$('pairing-form').previousElementSibling.previousElementSibling;pairingGuide.textContent='同じネットワーク内のMacは、中心PCのLAN接続を有効にし、両方のMacへ同じ版のREIアプリを置いて追加できます。開発用アプリは署名・公証と別Macでの確認がまだ完了していません。';
async function loadNetworkStatus() {
  const epoch=state.authEpoch;
  networkPanel.textContent='LAN接続を確認しています…';
  try {
    const status=await request('/api/network/lan/status');
    if(epoch!==state.authEpoch)return;
    if(status.state==='connected'){networkPanel.innerHTML=`<strong>✓ 同じネットワーク内の接続が使えます</strong><p>接続URL: <code>${escapeHtml(status.urls[0])}</code></p><p>中心PCと参加Macを同じネットワークにつないでください。別ネットワークからの接続はまだ未対応です。</p>${state.data?.user?.role==='owner'?'<button id="lan-disable" class="outline-button" type="button">LAN接続を停止</button>':''}`;$('pairing-url').value=status.urls[0];}
    else networkPanel.innerHTML=state.data?.user?.role==='owner'?`<strong>同じネットワーク内の接続</strong><p>${escapeHtml(status.error||'VPNアプリの導入なしで端末を追加できます。')}</p><button id="lan-enable" class="outline-button" type="button">LAN接続を有効にする</button>`:'<strong>LAN接続は所有者が有効にします</strong>';
    if($('network-refresh'))$('network-refresh').onclick=loadNetworkStatus;
    if($('lan-enable'))$('lan-enable').onclick=async()=>{const button=$('lan-enable');button.disabled=true;try{await request('/api/network/lan/enable',{method:'POST'});await loadNetworkStatus();}catch(error){networkPanel.textContent=error.message;}};
    if($('lan-disable'))$('lan-disable').onclick=async()=>{const button=$('lan-disable');button.disabled=true;try{await request('/api/network/lan/disable',{method:'POST'});$('pairing-url').value='';await loadNetworkStatus();}catch(error){networkPanel.textContent=error.message;}};
  }catch(error){if(epoch!==state.authEpoch)return;networkPanel.textContent=error.message;}
}
$('settings-open').onclick=async()=>{$('settings-screen').classList.remove('hidden');if(['owner','admin'].includes(state.data?.user?.role))void loadNetworkStatus();await refreshSettings();};
$('settings-close').onclick=()=>{$('settings-screen').classList.add('hidden');};
$('backup-create').onclick=async()=>{const button=$('backup-create');button.disabled=true;$('backup-result').textContent='データを保存しています…';try{const result=await request('/api/backup/create',{method:'POST'});$('backup-result').textContent=`保存先: ${result.folder}\nこのフォルダを外部ストレージにもコピーしてください。`;}catch(error){$('backup-result').textContent=error.message;}finally{button.disabled=false;}};
$('pairing-form').onsubmit=async event=>{event.preventDefault();const epoch=state.authEpoch;$('settings-feedback').textContent='';try{const hub=new URL($('pairing-url').value.trim());if(hub.username||hub.password||hub.search||hub.pathname!=='/')throw new Error('接続URLは表示されたアドレスだけを入力してください');const lan=hub.protocol==='https:'&&/^#rei-pin=[a-f0-9]{64}$/i.test(hub.hash);let invite=hub.origin;if(lan){const status=await request('/api/network/lan/status');if(epoch!==state.authEpoch)return;invite=hub.href;if(status.state!=='connected'||!status.urls.includes(invite))throw new Error('現在のLAN接続URLを確認できません。接続を再確認してください');}else if(hub.hash)throw new Error('接続URLの確認情報が正しくありません');else if(hub.protocol==='https:'){const status=await request('/api/network/status');if(epoch!==state.authEpoch)return;if(status.state!=='connected'||hub.origin!==status.url)throw new Error('現在の接続URLを確認できません。接続を再確認してください');}else if(hub.protocol!=='http:'||!['127.0.0.1','localhost'].includes(hub.hostname))throw new Error('表示された接続URLを入力してください');const data=await request('/api/devices/pairing',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:$('pairing-label').value.trim()})});if(epoch!==state.authEpoch)return;const result=$('pairing-result');
result.classList.remove('hidden');
result.textContent=`参加Macで行うこと（SSHは不要です）:\n① ${lan?'中心PCと同じネットワークに接続':'中心PCの接続先へ到達できるネットワークに接続'}\n② 中心PCと同じ版のREIアプリを参加Macへコピーして開く\n③ 「既存のREIに参加」を選び、接続URLと接続コードを順に貼り付ける\n\n接続URL: ${invite}\n接続コード（10分間有効）: ${data.code}\n\n接続後は「接続端末」の状態を更新してください。AIモデルの認証設定は参加Macでも必要です。`;
addCopyActions(result,[['接続URLをコピー',invite],['接続コードをコピー',data.code]]);
const advanced=document.createElement('details');advanced.className='advanced-setup';const summary=document.createElement('summary');summary.textContent='ZIP版・Windows・Linuxで追加する場合';advanced.append(summary);
const download=document.createElement('a');download.href='https://github.com/ywada-ga/rei-ai-company/archive/refs/heads/main.zip';download.target='_blank';download.rel='noopener noreferrer';download.textContent='開発用ZIPをダウンロード ↗';download.className='outline-button';advanced.append(download);
const macCommand=`git clone https://github.com/ywada-ga/rei-ai-company.git && cd rei-ai-company && node connector.mjs join '${invite}'`;
const windowsCommand=`git clone https://github.com/ywada-ga/rei-ai-company.git\ncd rei-ai-company\nnode connector.mjs join '${invite}'`;
const commands=document.createElement('p');commands.textContent=`Mac・Linux: ${macCommand}\nWindows PowerShell: ${windowsCommand}\n既にREIのフォルダがある場合: node connector.mjs join '${invite}'`;advanced.append(commands);addCopyActions(advanced,[['Mac・Linux用をコピー',macCommand],['Windows用をコピー',windowsCommand]]);result.append(advanced);await refreshSettings();}catch(e){if(epoch===state.authEpoch)$('settings-feedback').textContent=e.message;}};
$('enroll-form').onsubmit=async event=>{event.preventDefault();$('settings-feedback').textContent='';try{const data=await request('/api/devices/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:$('device-label').value.trim(),isPlanner:$('device-planner').checked})});$('enroll-result').classList.remove('hidden');$('enroll-result').textContent=`${data.device.label} の接続トークン（この画面で一度だけ表示）: ${data.token}\n接続先: ${location.origin}\n各Macで node connector.mjs setup を実行して入力してください。`;$('device-label').value='';await refreshSettings();await refresh();}catch(e){$('settings-feedback').textContent=e.message;}};
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
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$('auth-screen').classList.contains('hidden'))void refresh();});
