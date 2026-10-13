// 위 메뉴 막대(블렌더·윈도 앱 관례) — 누르면 열리고, 열린 채로 다른 메뉴에 마우스를 올리면 그 메뉴로. ↑↓ 항목 · ←→ 옆 메뉴·하위 메뉴 · Enter 실행 · Esc 닫기.
// 항목 옆의 단축키는 지금 설정(설정 › 단축키에서 바꾼 것)을 그대로 보여 준다.
import { label as keyLabel } from './keymap.js';
import { icon } from './icons.js';
import { esc } from './ui.js';

export class MenuBar {
  constructor(app, root, menus) {
    this.app = app; this.root = root; this.menus = menus;
    this.openIdx = -1; this.panels = [];
    root.setAttribute('role', 'menubar');
    root.innerHTML = menus.map((m, i) => `<button class="mtop" role="menuitem" aria-haspopup="true" aria-expanded="false" data-i="${i}">${esc(m.label)}</button>`).join('');
    this.tops = [...root.querySelectorAll('.mtop')];
    this.tops.forEach((b, i) => {
      b.addEventListener('mousedown', (e) => { e.preventDefault(); this.openIdx === i ? this.close() : this.open(i); });
      b.addEventListener('mouseenter', () => { if (this.openIdx >= 0 && this.openIdx !== i) this.open(i); });
      b.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.open(i, true); } });
    });
    document.addEventListener('mousedown', (e) => { if (this.openIdx >= 0 && !e.target.closest('.menu, .mtop')) this.close(); });
    window.addEventListener('blur', () => this.close());
  }

  resolve(it) {                                    // 메뉴 항목 → 그릴 정보
    if (it === '-') return { sep: true };
    if (typeof it === 'string') {
      const a = this.app.actions[it];
      if (!a) return { label: it, disabled: true };
      const keys = this.app.keymap.keys(it);
      return { label: a.label, run: a.run, key: keys.length ? keyLabel(keys[0]) : '', disabled: a.enabled ? !a.enabled() : false, checked: a.checked ? !!a.checked() : null };
    }
    if (it.list) { const items = it.list(); return { label: it.label, items: items.length ? items : [{ label: '(없음)', disabled: true }] }; }
    return it;
  }

  panel(items, x, y, level) {
    const p = document.createElement('div');
    p.className = 'menu'; p.setAttribute('role', 'menu');
    const rows = items.map((it) => this.resolve(it));
    p.innerHTML = rows.map((r, i) => r.sep ? '<div class="msep" role="separator"></div>'
      : `<button class="mi" role="${r.checked === null || r.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}"${r.checked != null ? ` aria-checked="${!!r.checked}"` : ''} data-i="${i}"${r.disabled ? ' disabled' : ''}>
          <span class="mc">${r.checked ? icon('check', 14) : ''}</span><span class="ml">${esc(r.label)}</span><span class="mk">${r.items ? icon('next', 14) : esc(r.key || '')}</span></button>`).join('');
    document.body.appendChild(p);
    const W = p.offsetWidth, H = p.offsetHeight;
    p.style.left = `${Math.min(x, innerWidth - W - 6)}px`;
    p.style.top = `${Math.min(y, innerHeight - H - 6)}px`;
    this.panels.length = level;                        // 이 층 아래 하위 메뉴는 닫음
    p.dataset.level = level;
    p.querySelectorAll('.mi').forEach((b) => {
      const r = rows[+b.dataset.i];
      b.addEventListener('mouseenter', () => { b.focus({ preventScroll: true }); this.closeFrom(level + 1); if (r.items && !b.disabled) this.sub(b, r.items, level + 1); });
      b.addEventListener('click', () => { if (r.items) { this.sub(b, r.items, level + 1, true); return; } this.close(); if (r.run) setTimeout(() => r.run(), 0); });
      b.addEventListener('keydown', (e) => this.key(e, p, b, r, level));
    });
    this.panels[level] = p;
    return p;
  }

  sub(b, items, level, focus) {
    const r = b.getBoundingClientRect();
    const p = this.panel(items, r.right - 4, r.top - 6, level);
    p.style.animation = 'none';
    if (focus) { const f = p.querySelector('.mi:not([disabled])'); if (f) f.focus(); }
  }

  closeFrom(level) {
    for (const p of document.querySelectorAll('.menu')) if (+p.dataset.level >= level) p.remove();
    this.panels.length = Math.min(this.panels.length, level);
  }

  key(e, p, b, r, level) {
    const items = [...p.querySelectorAll('.mi:not([disabled])')], i = items.indexOf(b);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (r.items) this.sub(b, r.items, level + 1, true); else this.open((this.openIdx + 1) % this.menus.length, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (level > 0) { this.closeFrom(level); const parent = this.panels[level - 1]; if (parent) { const f = parent.querySelector('.mi:focus') || parent.querySelector('.mi'); if (f) f.focus(); } } else this.open((this.openIdx - 1 + this.menus.length) % this.menus.length, true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const t = this.tops[this.openIdx]; this.close(); if (t) t.focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); }
  }

  open(i, focus) {
    const switching = this.openIdx >= 0;                 // 열린 채 옆 메뉴로 = 바로(하루 수십 번 하는 일이라 움직임 없이)
    this.close(true);
    this.openIdx = i;
    const t = this.tops[i], r = t.getBoundingClientRect();
    t.classList.add('on'); t.setAttribute('aria-expanded', 'true');
    const p = this.panel(this.menus[i].items, r.left, r.bottom + 2, 0);
    if (switching || focus) p.style.animation = 'none';
    if (focus) { const f = p.querySelector('.mi:not([disabled])'); if (f) f.focus(); }
  }

  close(keepIdx) {
    this.closeFrom(0);
    this.tops.forEach((t) => { t.classList.remove('on'); t.setAttribute('aria-expanded', 'false'); });
    if (!keepIdx) this.openIdx = -1;
  }
}
