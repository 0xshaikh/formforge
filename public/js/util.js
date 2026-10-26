'use strict';

/** Small shared helpers: DOM creation, escaping, toasts, modals. */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) node.value = v;
      else if (k === 'checked' && tag === 'input') node.checked = true;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  return node;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* ----- Toasts -------------------------------------------------------- */
function toast(message, kind) {
  const wrap = $('#toasts');
  if (!wrap) return;
  const node = el('div', { class: `toast${kind ? ` is-${kind}` : ''}` }, message);
  wrap.appendChild(node);
  const t = setTimeout(() => {
    node.classList.add('fade');
    setTimeout(() => node.remove(), 280);
  }, 3600);
  node.addEventListener('click', () => {
    clearTimeout(t);
    node.remove();
  });
}

/* ----- Confirm modal ------------------------------------------------- */
function confirmDialog({ title, message, confirmText = 'Delete', cancelText = 'Cancel', danger = true }) {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'overlay' });
    const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('h3', null, title),
      el('p', null, message),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn btn-outline', text: cancelText, onclick: () => { overlay.remove(); resolve(false); } }),
        el('button', {
          class: `btn ${danger ? 'btn-primary' : 'btn-outline'}`,
          style: danger ? { background: 'var(--danger)', boxShadow: '0 8px 22px rgba(220,38,38,.3)' } : null,
          text: confirmText,
          onclick: () => { overlay.remove(); resolve(true); },
        }),
      ),
    );
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(false); }
    });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key !== 'Escape') return;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(false);
    });
    document.body.appendChild(overlay);
    modal.querySelector('button').focus();
  });
}

/* ----- Formatting ---------------------------------------------------- */
function timeAgo(iso) {
  const then = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

window.FF = {
  $, $$, el, escapeHtml, uid, toast, confirmDialog, timeAgo, debounce,
};
