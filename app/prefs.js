// 환경 설정 — 블렌더 Preferences 처럼 왼쪽 탭: 일반 · 조작 · 단축키 · 저장 · AI · 업데이트 · 정보.
// 단축키 탭: 동작마다 [바꾸기] → 새 키를 누르면 바뀜(Esc 취소 · Backspace 비우기), 이미 쓰는 키면 어디서 쓰는지 묻고 옮김. 바꾼 것만 prefs.keymap 에 저장.
import { openModal, ask, $, esc } from './ui.js';
import { label as keyLabel, comboOf, HOLD } from './keymap.js';
import { icon } from './icons.js';

const TABS = [['general', '일반', 'settings'], ['controls', '조작', 'move'], ['keys', '단축키', 'keys'], ['files', '저장', 'save'], ['ai', 'AI', 'ai'], ['update', '업데이트', 'reset'], ['about', '정보', 'help']];

export class PrefsUI {
  constructor(app) { this.app = app; this.tab = 'general'; this.q = ''; }

  open(tab = this.tab) {
    this.endCapture();
    if (!this.bound) { this.bound = true; $('prefsModal').addEventListener('cancel', () => this.endCapture()); }   // X · Esc · 바깥 누르기로 닫으면 키 기다리기도 끝
    this.tab = tab;
    $('prefsTabs').innerHTML = TABS.map(([id, label, ic]) => `<button role="tab" data-tab="${id}" aria-selected="${id === this.tab}" class="${id === this.tab ? 'on' : ''}">${icon(ic, 16)}${label}</button>`).join('');
    $('prefsTabs').querySelectorAll('button').forEach((b) => { b.onclick = () => this.open(b.dataset.tab); });
    this.render();
    openModal('prefsModal');
  }

  endCapture() { if (this.stopCapture) this.stopCapture(); }

  render() {
    this.endCapture();
    const body = $('prefsBody'), a = this.app, p = a.prefs;
    const toggle = (id, label, on, help = '') => `<label class="tog big"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span>${label}${help ? `<small>${help}</small>` : ''}</span></label>`;
    const num = (id, label, v, min, max, step, unit) => `<label class="numrow"><span>${label}</span><input type="number" id="${id}" value="${v}" min="${min}" max="${max}" step="${step}"><small>${unit}</small></label>`;
    if (this.tab === 'general') {
      body.innerHTML = `<h4>화면</h4>${toggle('pEasy', '쉬운 모드', p.easy, '꼭 필요한 버튼만 보입니다. 끄면 전체 기능.')}
        ${toggle('pPins', '수정 메모 핀 보이기', p.pins !== false, '3D 화면에 메모 번호를 띄웁니다.')}
        <h4>시작</h4>${toggle('pResume', '지난 작업 이어서 열기', p.resume !== false, '끄면 켤 때마다 새 프로젝트 고르기 창이 뜹니다.')}`;
      $('pEasy').onchange = () => a.setEasy($('pEasy').checked);
      $('pPins').onchange = () => { p.pins = $('pPins').checked; a.savePrefs(); a.notes.drawPins(); };
      $('pResume').onchange = () => { p.resume = $('pResume').checked; a.savePrefs(); };
    } else if (this.tab === 'controls') {
      body.innerHTML = `<h4>날기</h4>${num('pSpeed', '이동 속도', p.speed, 0.1, 60, 0.1, 'm/s')}${num('pTurn', '고개 회전 속도 (Q·E)', p.turn, 15, 360, 15, '°/s')}${num('pEye', '걷기 모드 눈높이', p.eye, 0.3, 3, 0.1, 'm')}
        <h4>마우스</h4>${num('pSens', '마우스 감도', p.sens, 0.2, 4, 0.1, '배')}${toggle('pInvert', '세로 반전', p.invertY, '위로 끌면 아래를 봅니다.')}
        <p class="hint">더블클릭 = 그 자리로 이동 · Shift+휠 = 렌즈를 바꿔도 피사체 크기 유지 · 기즈모를 끌 때 Ctrl = 0.5 m·15° 단위</p>`;
      const bind = (id, key, f = parseFloat) => { $(id).onchange = () => { const v = f($(id).value); if (!Number.isNaN(v)) { if (key === 'speed') a.setSpeed(v); else { p[key] = v; a.savePrefs(); } a.syncPrefsUI(); } }; };
      bind('pSpeed', 'speed'); bind('pTurn', 'turn'); bind('pEye', 'eye'); bind('pSens', 'sens');
      $('pInvert').onchange = () => { p.invertY = $('pInvert').checked; a.savePrefs(); a.syncPrefsUI(); };
    } else if (this.tab === 'keys') this.renderKeys(body);
    else if (this.tab === 'files') {
      body.innerHTML = `<h4>저장되는 곳</h4><p class="hint">지금 작업은 바뀔 때마다 자동으로 이 앱 안에도 남아, 그냥 닫거나 PC 가 꺼져도 다음에 그대로 이어서 열립니다.</p>
        <div id="pFolders" class="hint">확인 중…</div><div class="btns left"><button id="pOpenFolder">${icon('open', 16)}프로젝트 폴더 열기</button><button id="pOpenExports">${icon('film', 16)}내보낸 파일 폴더 열기</button></div>
        <h4>자동 저장</h4><p class="hint">바뀐 것이 있으면 2분마다 자동저장 폴더에 최근 10개를 남깁니다. 파일 › 자동 저장에서 되살리기.</p><div class="btns left"><button id="pRecover">자동 저장 목록…</button></div>`;
      fetch('/api/version').then((r) => r.json()).then((v) => {
        const f = v.folders || {}, row = (k, t) => (f[k] ? `<div><b>${t}</b><div class="path">${esc(f[k])}</div></div>` : '');
        $('pFolders').innerHTML = row('project', '프로젝트') + row('autosave', '자동 저장') + row('export', 'AI 가 내보낸 파일') + row('backup', '자동 백업')
          + (/files[\\/]/.test(f.project || '') ? '<p class="hint">이 PC 는 문서 폴더에 쓸 수 없어(보안 설정 등) 앱 폴더에 저장합니다.</p>' : '');
      }).catch(() => { $('pFolders').textContent = '앱 서버 없이 열린 창 — 저장은 내려받기로 됩니다'; });
      $('pOpenFolder').onclick = () => a.actions['file.showFolder'].run();
      $('pOpenExports').onclick = () => a.actions['file.showExports'].run();
      $('pRecover').onclick = () => a.projects.recoverDialog();
    } else if (this.tab === 'ai') {
      body.innerHTML = `<h4>AI 연결 (MCP)</h4><p>Claude · ChatGPT(Codex) 같은 AI 앱이 이 창을 직접 고칩니다. 앱마다 한 번 연결하면 됩니다.</p>
        <div class="btns left"><button class="primary" id="pAI">${icon('ai', 16)}AI 연결 창 열기</button><button id="pPrompt">메모 맡기는 말 복사</button></div>
        <h4>에이전트 모드</h4><p class="hint">위쪽 「에이전트」를 켜면 화면을 눌러 고칠 곳(물체·배경·피사체·구간·동선·카메라 장면)을 고르고 메모를 남깁니다. AI 에게 「메모대로 고쳐 줘」 하면 메모를 읽고 고친 뒤 완료로 표시합니다.</p>`;
      $('pAI').onclick = () => a.actions['ai.connect'].run();
      $('pPrompt').onclick = () => a.actions['ai.copyPrompt'].run();
    } else if (this.tab === 'update') {
      body.innerHTML = `<h4>버전</h4><p class="big" id="pVer">${esc(a.version || '')}</p><p id="pUpd" class="hint" role="status" aria-atomic="true">확인 중…</p>
        <div class="btns left"><button class="primary" id="pCheck">지금 확인</button><button id="pNotes">바뀐 점 보기</button></div>
        <h4>자동 업데이트</h4><label class="tog big"><input type="checkbox" id="pAuto"><span>새 판이 나오면 미리 받아 두고, 다음에 켤 때 바꾸기<small>GitHub 릴리스에서 받습니다. 끄면 「업데이트 확인」을 눌렀을 때만.</small></span></label>`;
      a.updates.refresh().then((s) => { if (!s) return; $('pUpd').textContent = a.updates.text(s); $('pAuto').checked = s.auto !== false; });
      $('pCheck').onclick = async () => { $('pUpd').textContent = '확인 중…'; const s = await a.updates.check(); if (s) $('pUpd').textContent = a.updates.text(s); };
      $('pNotes').onclick = () => a.actions['help.releases'].run();
      $('pAuto').onchange = () => fetch('/api/settings', { method: 'POST', body: JSON.stringify({ auto_update: $('pAuto').checked }) }).catch(() => {});
    } else {
      const repo = a.versionInfo && a.versionInfo.repo;
      body.innerHTML = `<div class="about"><div class="logo">${icon('camera', 40)}</div><div><h3>블록아웃 스튜디오</h3><p>${esc(a.version || '')} · 회색 3D 로 카메라 무빙과 동선을 잡아 보는 '어린이 블렌더'</p>
        ${repo ? `<p><a href="https://github.com/${esc(repo)}" target="_blank" rel="noopener">github.com/${esc(repo)}</a></p>` : ''}
        <p class="hint">MIT 라이선스 · three.js (MIT) · mp4-muxer (MIT) · 글꼴 BlockoutSans = Pretendard 일부 (SIL OFL 1.1, app/fonts/OFL.txt)</p></div></div>`;
    }
  }

  renderKeys(body) {
    const a = this.app, km = a.keymap, groups = new Map();
    for (const [id, act] of Object.entries(a.actions)) {
      if (!act.group || !km.keys(id) || (!act.run && !HOLD.has(id))) continue;
      if (this.q && !`${act.label} ${km.keys(id).map(keyLabel).join(' ')}`.toLowerCase().includes(this.q.toLowerCase())) continue;
      if (!groups.has(act.group)) groups.set(act.group, []);
      groups.get(act.group).push(id);
    }
    body.innerHTML = `<div class="keytools"><input id="kSearch" type="search" placeholder="동작이나 키로 찾기 (예: 저장, Ctrl+S)" value="${esc(this.q)}"><button id="kResetAll" class="danger">모두 기본값으로</button></div>
      <div class="keylist">${[...groups].map(([g, ids]) => `<h4>${esc(g)}</h4>${ids.map((id) => `<div class="krow" data-id="${id}"><span class="kl">${esc(a.actions[id].label)}</span>
        <span class="kc">${km.keys(id).map((c) => `<kbd>${esc(keyLabel(c))}</kbd>`).join('') || '<small>없음</small>'}</span>
        <button class="kb" data-act="set">바꾸기</button><button class="kb" data-act="def"${a.prefs.keymap && a.prefs.keymap[id] ? '' : ' disabled'}>기본값</button></div>`).join('')}`).join('')}</div>
      <p class="hint" id="kHint">[바꾸기]를 누른 뒤 새 키를 누르세요 · Esc = 취소 · Backspace = 비우기</p>`;
    $('kSearch').oninput = () => { this.q = $('kSearch').value; const pos = $('kSearch').selectionStart; this.render(); $('kSearch').focus(); $('kSearch').setSelectionRange(pos, pos); };
    $('kResetAll').onclick = async () => { if (await ask({ title: '단축키를 모두 기본값으로', text: '바꾼 단축키가 모두 처음대로 돌아갑니다.', buttons: [{ label: '취소', value: null }, { label: '기본값으로', value: 1, danger: true }] })) { km.reset(); a.savePrefs(); a.refreshKeyHints(); this.render(); } };
    body.querySelectorAll('.krow').forEach((row) => {
      const id = row.dataset.id;
      row.querySelector('[data-act="def"]').onclick = () => { const k = { ...(km.prefs.keymap || {}) }; delete k[id]; km.prefs.keymap = k; km.rebuild(); a.savePrefs(); a.refreshKeyHints(); this.render(); };
      row.querySelector('[data-act="set"]').onclick = (ev) => this.capture(id, ev.currentTarget);
    });
  }

  capture(id, btn) {
    const a = this.app, km = a.keymap;
    this.endCapture();                                                 // 앞의 [바꾸기]가 기다리던 것은 끝냄(키 하나가 두 동작에 들어가지 않게)
    btn.textContent = '키를 누르세요…'; btn.classList.add('wait');
    a.capturingKeys = true;
    const done = () => { window.removeEventListener('keydown', onKey, true); a.capturingKeys = false; this.stopCapture = null; btn.textContent = '바꾸기'; btn.classList.remove('wait'); };
    this.stopCapture = done;
    const onKey = async (e) => {
      if (/^(Control|Shift|Alt|Meta)/.test(e.code)) return;             // 수식키만 눌렀을 땐 기다림
      e.preventDefault(); e.stopPropagation();
      done();
      if (e.code === 'Escape') { this.render(); return; }
      if (e.code === 'Backspace' && !e.ctrlKey && !e.shiftKey && !e.altKey) { km.set(id, []); a.savePrefs(); a.refreshKeyHints(); this.render(); return; }
      const combo = HOLD.has(id) ? e.code : comboOf(e);
      const clash = km.conflicts(id, combo);
      if (clash.length) {
        const names = clash.map((c) => (a.actions[c] && a.actions[c].label) || c).join(', ');
        const ok = await ask({ title: `${keyLabel(combo)} 는 이미 쓰고 있습니다`, text: `「${names}」 에서 빼고 「${a.actions[id].label}」 에 줄까요?`, buttons: [{ label: '취소', value: null }, { label: '옮기기', value: 1, primary: true }] });
        if (!ok) { this.render(); return; }
        for (const c of clash) km.set(c, km.keys(c).filter((x) => x !== combo));
      }
      km.set(id, [combo]);
      a.savePrefs(); a.refreshKeyHints(); this.render();
      a.toast(`${a.actions[id].label} = ${keyLabel(combo)}`);
    };
    window.addEventListener('keydown', onKey, true);
  }
}
