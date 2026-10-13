// 창(모달) 공용 — Esc·바깥 누르기·닫기 버튼으로 닫힘, 열리면 첫 칸에 포커스, 닫히면 원래 자리로 포커스(키보드만으로도 쓸 수 있게).
// ask() 는 브라우저 confirm 대신 쓰는 세 갈래 질문(예: 저장 · 저장 안 함 · 취소), askText() 는 이름 입력.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const imgSrc = (s) => (typeof s === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : '');   // 파일에서 온 썸네일은 그림 data: 만(다른 건 버림)
const stack = [];

// 다시 그려도 키보드 초점이 같은 자리 버튼에 남게(카드 「멈춤」·메모 「완료로」를 키보드로 눌렀을 때 초점이 맨 위로 튀지 않게)
export function keepFocus(box, render) {
  const all = () => [...box.querySelectorAll('button')];
  const i = box.contains(document.activeElement) ? all().indexOf(document.activeElement) : -1;
  render();
  if (i >= 0) { const list = all(), b = list[Math.min(i, list.length - 1)]; if (b) b.focus({ preventScroll: true }); }
}

export function openModal(el) {
  if (typeof el === 'string') el = $(el);
  if (!el || el.style.display === 'flex') return el;
  stack.push({ el, back: document.activeElement });
  el.style.display = 'flex';
  el.setAttribute('aria-modal', 'true');
  const first = ['[autofocus]', 'input:not([type=checkbox]), textarea, select', 'button.primary', 'button:not([data-close])', 'button'].map((s) => el.querySelector(s)).find(Boolean);
  if (first) setTimeout(() => first.focus(), 0);
  return el;
}

export function closeModal(el) {
  if (typeof el === 'string') el = $(el);
  if (!el) return;
  el.style.display = 'none';
  const i = stack.findIndex((s) => s.el === el);
  if (i >= 0) { const { back } = stack[i]; stack.splice(i, 1); if (back && back.focus) back.focus(); }
  if (el.dataset.temp) el.remove();
}

export function topModal() { return stack.length ? stack[stack.length - 1].el : null; }

export function bindModals() {
  document.addEventListener('keydown', (e) => {
    const m = topModal();
    if (!m) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); m.dispatchEvent(new Event('cancel')); closeModal(m); }
    if (e.key === 'Tab') {                                                     // 포커스가 창 밖으로 안 나가게
      const f = [...m.querySelectorAll('button, input, textarea, select, a[href], summary, [tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }, true);
  document.addEventListener('mousedown', (e) => { const m = topModal(); if (m && e.target === m) { m.dispatchEvent(new Event('cancel')); closeModal(m); } });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-close]'); if (b) { const m = b.closest('.modal'); m.dispatchEvent(new Event('cancel')); closeModal(m); } });
}

function tempModal(html, title = '') {
  const m = document.createElement('div');
  m.className = 'modal'; m.dataset.temp = '1'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', title);
  m.innerHTML = `<div class="box small">${html}</div>`;
  document.body.appendChild(m);
  return m;
}

// buttons: [{ label, value, primary?, danger? }] — 누른 value 를 돌려줌, Esc·바깥 = null. list = 글머리 목록(바뀐 점 등)
export function ask({ title, text = '', list = null, buttons }) {
  return new Promise((resolve) => {
    const m = tempModal(`<h3>${esc(title)}</h3>${text ? `<p class="lead">${esc(text)}</p>` : ''}${list && list.length ? `<ul class="alist">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<div class="btns">${buttons.map((b, i) =>
      `<button data-i="${i}" class="${b.primary ? 'primary' : ''}${b.danger ? ' danger' : ''}">${esc(b.label)}</button>`).join('')}</div>`, title);
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    m.addEventListener('cancel', () => finish(null));
    m.querySelectorAll('button[data-i]').forEach((b) => { b.onclick = () => { finish(buttons[+b.dataset.i].value); closeModal(m); }; });
    openModal(m);
    const p = m.querySelector('button.primary'); if (p) setTimeout(() => p.focus(), 0);
  });
}

export function askText({ title, label = '', value = '', ok = '확인', placeholder = '', allowEmpty = false }) {
  return new Promise((resolve) => {
    const m = tempModal(`<h3>${esc(title)}</h3><label class="field">${esc(label)}<input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="80" autofocus><small class="err" aria-live="polite"></small></label>
      <div class="btns"><button data-close>취소</button><button class="primary" data-ok>${esc(ok)}</button></div>`, title);
    const inp = m.querySelector('input'), err = m.querySelector('.err');
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    const okay = () => {
      const v = inp.value.trim();
      if (!v && !allowEmpty) { err.textContent = '비어 있습니다 — 넣어 주세요'; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
      finish(v); closeModal(m);
    };
    m.addEventListener('cancel', () => finish(null));
    m.querySelector('[data-ok]').onclick = okay;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); okay(); } });
    openModal(m);
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  });
}
