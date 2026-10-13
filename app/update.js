// 업데이트 — 오른쪽 아래 「v1.5.0 · 업데이트 확인」. 새 판이 있으면 버튼이 살짝 빛나고(받는 중·준비됨),
// 누르면 「지금 다시 시작」(앱이 새 exe 로 바꿔 끼우고 다시 켬) 또는 「다음에 켤 때」. 서버 쪽은 server_api.Updater(GitHub 릴리스 · 규칙은 README).
// 공지: 바꿔 끼운 뒤 처음 켜면 「v… 로 바뀌었습니다」 + 바뀐 점(한 번), 새 판을 받아 두면 토스트 한 번 — 그 밖엔 버튼만 빛남(조르지 않음).
import { ask, $ } from './ui.js';

export class Updates {
  constructor(app) {
    this.app = app; this.s = null;
    $('btnUpdate').onclick = () => this.open();
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 15000);
  }

  async refresh() {
    const before = this.s && this.s.state;
    try { const r = await fetch('/api/update/status', { cache: 'no-store' }); this.s = r.ok ? await r.json() : null; } catch (e) { this.s = null; }
    this.paint();
    const s = this.s;
    if (s && s.just_updated && !this.shownJust) { this.shownJust = true; this.announce(s.just_updated); }
    if (s && s.state === 'ready' && before && before !== 'ready') this.app.toast(`새 판 v${s.latest} 을(를) 받아 두었습니다 — 다음에 켤 때 바뀝니다(지금 바꾸려면 오른쪽 아래 버튼)`);
    return s;
  }

  async announce(j) {              // 바꿔 끼운 뒤 처음 켬 — 한 번만(서버에 「봤음」)
    await this.app.ready;
    const repo = this.s && this.s.repo;
    const v = await ask({ title: `v${j.to} 로 업데이트되었습니다`, text: j.from ? `v${j.from} → v${j.to}. 작업은 그대로 이어서 열렸습니다.` : '작업은 그대로 이어서 열렸습니다.', list: j.notes,
      buttons: [...(repo ? [{ label: '바뀐 점 전체', value: 'notes' }] : []), { label: '확인', value: 1, primary: true }] });
    if (v === 'notes' && repo) window.open(`https://github.com/${repo}/releases`, '_blank');
    fetch('/api/update/ack', { method: 'POST' }).catch(() => {});
  }

  async check() {
    try { const r = await fetch('/api/update/check', { method: 'POST' }); this.s = await r.json(); } catch (e) { this.s = null; }
    this.paint();
    return this.s;
  }

  text(s = this.s) {
    if (!s) return '업데이트 확인은 앱(exe)으로 열었을 때 됩니다';
    const L = s.latest ? `v${s.latest}` : '';
    return {
      idle: '아직 확인 안 함', checking: '확인 중…', none: `최신 판입니다 (v${s.current})`, manual: `새 판 ${L} — ${s.error}`,
      available: s.can_install ? `새 판 ${L} 이(가) 나왔습니다 — 누르면 받습니다` : `새 판 ${L} 이(가) 나왔습니다 — GitHub 에서 받으세요`,
      downloading: `새 판 ${L} 받는 중 ${Math.round((s.progress || 0) * 100)}%`, ready: `새 판 ${L} 준비됨 — 다시 시작하면 바뀝니다`,
      error: `확인하지 못했습니다 — 인터넷 연결을 확인하세요 (${s.error || ''})`,
    }[s.state] || s.state;
  }

  paint() {
    const s = this.s, b = $('btnUpdate'), cur = (s && s.current) || (this.app.version || '').replace(/^v/, '');
    const fresh = s && ['available', 'downloading', 'ready', 'manual'].includes(s.state);
    b.classList.toggle('glow', !!fresh);
    b.classList.toggle('ready', !!(s && s.state === 'ready'));
    $('verLabel').textContent = `v${cur}`;
    $('updLabel').textContent = !s ? '업데이트 확인' : s.state === 'ready' ? '다시 켜면 업데이트' : s.state === 'downloading' ? `받는 중 ${Math.round(s.progress * 100)}%` : (s.state === 'available' || s.state === 'manual') ? `새 판 v${s.latest}` : '업데이트 확인';
    b.title = this.text(s);
    $('updStatus').textContent = fresh ? this.text(s) : '';          // 읽어 주는 상태 문구(소리 내는 화면 읽기 도구용)
  }

  async open() {
    let s = this.s || await this.refresh();
    if (!s) { this.app.toast(this.text(null)); return; }
    if (!['available', 'ready', 'downloading', 'manual'].includes(s.state)) { this.app.toast('확인 중…'); s = await this.check(); }
    if (!s) return;
    if ((s.state === 'available' && !s.can_install) || s.state === 'manual') {
      if (await ask({ title: `새 판 v${s.latest}`, text: s.state === 'manual' ? s.error : '개발 서버로 열려 있어 바로 바꿀 수 없습니다. GitHub 에서 받으세요.', list: s.notes,
        buttons: [{ label: '닫기', value: null }, { label: 'GitHub 열기', value: 1, primary: true }] })) window.open(s.release_url, '_blank');
      return;
    }
    if (s.state === 'available') {
      const v = await ask({ title: `새 판 v${s.latest} 이(가) 나왔습니다`, text: `지금 판 v${s.current}. 받아 두면 다음에 켤 때 바뀝니다(작업은 그대로).`, list: s.notes,
        buttons: [{ label: '다음에', value: null }, { label: '받기', value: 1, primary: true }] });
      if (v === 1) {
        await fetch('/api/update/download', { method: 'POST' });
        this.app.toast('새 판을 받는 중 — 오른쪽 아래에서 진행을 보여 줍니다');
        this.refresh();
      }
      return;
    }
    if (s.state === 'downloading') { this.app.toast(this.text(s)); return; }
    if (s.state === 'ready') {
      const v = await ask({ title: `새 판 v${s.latest} 준비됨`, text: '지금 다시 시작하면 바로 바뀝니다(1~2초). 저장하지 않은 작업은 먼저 저장합니다.', list: s.notes,
        buttons: [{ label: '다음에 켤 때', value: null }, { label: '지금 다시 시작', value: 1, primary: true }] });
      if (v !== 1) return;
      if (this.app.projects.dirty && !(await this.app.projects.save())) return;
      this.app.projects.dirty = false;
      this.app.status('새 판으로 다시 시작하는 중…'); this.app.toast('다시 시작합니다…');
      this.app.saveLocal(); await this.app.projects.flushSession();     // 세션도 지금 상태로(새 판이 이어서 엶)
      await fetch('/api/update/apply', { method: 'POST' }).catch(() => {});
      clearInterval(this.timer);
      const from = s.current;                                          // 이 창이 안 닫히고 남으면(브라우저가 다른 창에 넘긴 경우) 새 판 서버가 뜨는 대로 새로 고침
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        try { const v = await (await fetch('/api/version', { cache: 'no-store' })).json(); if (v.version && v.version !== from) { location.reload(); return; } } catch (e) { /* 아직 다시 켜는 중 */ }
      }
      return;
    }
    this.app.toast(this.text(s));
  }
}
