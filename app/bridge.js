// AI 연결(MCP) — 앱 서버(/bridge)와 긴 폴링으로 붙어 AI 가 보낸 명령을 이 창에서 실행하고, 「AI 연결」 창(한 번에 연결 · 다른 앱용 설정 · AI 가 한 일)을 그린다.
// 명령 목록·실행은 app/api.js. 서버 쪽은 mcp_bridge.py.
import { describe, run } from './api.js';
import { openModal, $, esc } from './ui.js';

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function startBridge(app, ctx) {
  if (!/^https?:$/.test(location.protocol)) return;            // 파일로 연 창(file://)은 다리 없음
  ctx.onLog = () => renderLog(ctx);
  // 창이 여럿이면 명령은 앞에 보이는(마지막으로 포커스 받은) 창 하나만 받는다 — 창마다 이름표를 달고 앞에 나옴·숨음·닫힘을 알림
  const PAGE = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/-/g, '').slice(0, 16);
  const q = (focus) => `page=${PAGE}&vis=${document.visibilityState === 'visible' ? 1 : 0}&focus=${focus ? 1 : 0}`;
  const tell = (focus) => fetch(`/bridge/focus?${q(focus)}`, { method: 'POST', keepalive: true }).catch(() => {});
  window.addEventListener('focus', () => tell(true));
  document.addEventListener('visibilitychange', () => tell(false));
  window.addEventListener('pagehide', () => { try { navigator.sendBeacon(`/bridge/bye?page=${PAGE}`); } catch (e) { /* 무시 */ } });
  const hello = async () => { const r = await post(`/bridge/hello?page=${PAGE}`, await describe(app, ctx)); if (!r.ok) throw new Error(`hello ${r.status}`); };
  (async () => {
    let wait = 1000;
    try { await hello(); } catch (e) { /* 다리 없는 옛 서버면 아래 poll 이 404 로 끝냄 */ }
    for (;;) {
      try {
        const r = await fetch(`/bridge/poll?${q(document.hasFocus())}`, { cache: 'no-store' });
        if (r.status === 404 || r.status === 501) return;
        if (r.status === 204) { wait = 1000; continue; }
        if (!r.ok) throw new Error(`poll ${r.status}`);
        const cmd = await r.json();
        if (cmd.type === 'hello') { await hello(); continue; }      // 서버가 새로 떴음 — 도구 목록부터
        if (cmd.type === 'call') { const res = await run(app, ctx, cmd); await post('/bridge/result', { id: cmd.id, ...res }); }
        wait = 1000;
      } catch (e) { await new Promise((ok) => setTimeout(ok, wait)); wait = Math.min(wait * 2, 10000); }
    }
  })();
  refreshAIStatus(app, ctx);                                       // 연결 상태: 켤 때 · 1분마다(AI 앱 설정을 바꾸고 와도 맞게)
  setInterval(() => refreshAIStatus(app, ctx), 60000);
  setInterval(() => {                                              // 위쪽 「AI 연결」 점: 2분 안에 AI 가 일했으면 초록
    const on = ctx.lastAt && performance.now() - ctx.lastAt < 120000;
    const d = $('aiDot'); if (d) d.classList.toggle('on', !!on);
    const b = $('btnAI'); if (b) b.title = on ? `AI(${ctx.lastWho}) 가 작업 중 — 누르면 한 일 목록` : 'AI 연결 — Claude · ChatGPT(Codex) 가 이 화면을 말로 만들게';
  }, 2000);
}

function renderLog(ctx) {
  const ol = $('aiLog'); if (!ol) return;
  ol.innerHTML = ctx.log.length ? ctx.log.slice(0, 30).map((x) => `<li><span class="t">${x.at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> <b>${esc(x.who)}</b> ${esc(x.text)}</li>`).join('') : '<li class="none">아직 없음 — AI 앱에서 말을 걸면 여기에 쌓입니다</li>';
}

// 연결 상태 — Claude·Codex 설정에 이 앱이 들어 있는지(경로까지), AI 가 최근에 부른 적이 있는지. 앱 버튼·띠 글자를 이에 맞춤(연결 안 됐는데 AI 를 조르지 않게)
export async function refreshAIStatus(app, ctx) {
  try {
    const [setup, st] = await Promise.all([fetch('/bridge/setup', { cache: 'no-store' }), fetch('/bridge/status', { cache: 'no-store' })].map((p) => p.then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    ctx.status = setup ? { configured: !!(setup.claude.connected || setup.codex.connected), stale: !!(setup.claude.stale || setup.codex.stale),
      recent: !!(st && st.last_call_ago !== null && st.last_call_ago !== undefined && st.last_call_ago < 1800), clients: (st && st.clients) || {}, setup } : { configured: false, recent: false, server: false };
  } catch (e) { ctx.status = { configured: false, recent: false, server: false }; }
  if (app.syncAIUI) app.syncAIUI();
  return ctx.status;
}

const NAMES = { claude: 'Claude 데스크톱', codex: 'ChatGPT 데스크톱 · Codex' };

function nowLine(ctx) {               // 「지금」 한 줄
  const s = ctx.status || {}, setup = s.setup;
  if (!setup) return '이 창은 앱 서버 없이 열려 있어 AI 를 연결할 수 없습니다 — 「블록아웃 스튜디오.exe」 로 여세요.';
  const on = ['claude', 'codex'].filter((k) => setup[k].connected).map((k) => NAMES[k]);
  const used = Object.entries(s.clients || {}).sort((a, b) => a[1] - b[1])[0];
  const parts = [];
  parts.push(on.length ? `<b>${esc(on.join(' · '))}</b>에 연결돼 있습니다` : '<b>아직 연결된 AI 가 없습니다</b> — 아래 1·2·3 만 하면 됩니다');
  if (used) parts.push(`마지막 사용: ${esc(used[0])} (${used[1] < 90 ? '방금' : `${Math.round(used[1] / 60)}분 전`})`);
  if (s.stale) parts.push('<b>「다시 연결」 필요</b> — 이 앱을 다른 폴더로 옮긴 뒤라 AI 앱이 옛 자리를 찾습니다');
  return parts.join(' · ');
}

function fill(info, ctx) {
  const card = (key, st) => {
    const el = $(key === 'claude' ? 'aiClaude' : 'aiCodex');
    el.classList.toggle('ok', !!st.connected); el.classList.toggle('stale', !!st.stale);
    el.querySelector('p').textContent = !st.found ? `이 PC 에 ${{ claude: 'Claude 데스크톱이', codex: 'ChatGPT 데스크톱(Codex)이' }[key]} 없습니다 — 설치하면 여기서 바로 연결됩니다.`
      : st.stale ? '이 앱의 자리가 바뀌었습니다 — 「다시 연결」을 누르세요.'
        : st.connected ? '연결돼 있습니다. 그 AI 앱을 껐다 켰다면 바로 쓸 수 있습니다.' : '아직 연결 안 됨 — 버튼 한 번이면 됩니다.';
    const b = el.querySelector('button'); b.disabled = !st.found; b.textContent = st.connected ? '다시 연결' : st.stale ? '다시 연결' : '연결';
  };
  card('claude', info.claude);
  card('codex', info.codex);
  const s = info.snippets;
  const snips = [
    ['Claude Code', '명령 창에 한 줄', s.claude_code],
    ['Codex CLI', '명령 창에 한 줄', s.codex_cli],
    ['Cursor · Windsurf · Claude 데스크톱(직접)', '설정의 mcpServers 에 넣기', s.json],
    ['VS Code', '.vscode/mcp.json', s.vscode],
    ['주소로 붙는 앱', '이 앱이 켜져 있을 때만', s.url],
  ];
  $('aiSnips').innerHTML = snips.map(([t, how, v], i) => `<div class="snip"><b>${esc(t)}<small>${esc(how)}</small></b><div class="row2"><pre>${esc(v)}</pre><button data-copy="${i}">복사</button></div></div>`).join('');
  $('aiSnips').querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => { const v = snips[+b.dataset.copy][2]; try { await navigator.clipboard.writeText(v); b.textContent = '복사됨'; setTimeout(() => { b.textContent = '복사'; }, 1500); } catch (e) { $('aiMsg').textContent = '복사가 막혀 있음 — 글을 드래그해 복사하세요.'; } };
  });
  $('aiOut').textContent = info.output;
  $('aiNow').innerHTML = nowLine(ctx);
}

export async function openAI(app, ctx) {
  openModal('aiModal');
  renderLog(ctx);
  $('aiMsg').textContent = '';
  const st = await refreshAIStatus(app, ctx);
  if (st.setup) fill(st.setup, ctx);
  else $('aiNow').innerHTML = nowLine(ctx);
  if (openAI.bound) return;
  openAI.bound = true;
  document.querySelectorAll('#aiModal [data-client]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true; $('aiMsg').textContent = '연결하는 중…';
      try {
        const r = await (await post('/bridge/setup', { client: b.dataset.client })).json();
        $('aiMsg').textContent = r.message;
        const s2 = await refreshAIStatus(app, ctx);
        if (s2.setup) fill(s2.setup, ctx);
      } catch (e) { $('aiMsg').textContent = `연결하지 못했습니다: ${e.message}`; b.disabled = false; }
    };
  });
}
