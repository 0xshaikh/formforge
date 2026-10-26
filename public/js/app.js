'use strict';

/**
 * Application bootstrap: hash router, public form pages, embed mode, crumbs.
 */

const App = (() => {
  const { el, $, toast } = window.FF;

  let active = null;

  function crumbs(text) {
    const node = $('#crumbs');
    if (node) node.textContent = text || '';
  }

  function loading() {
    $('#app').innerHTML =
      '<div class="page"><div style="display:grid;place-items:center;min-height:55vh">' +
      '<div style="display:flex;flex-direction:column;align-items:center;gap:13px">' +
      '<div class="spinner" style="width:24px;height:24px;border-width:3px"></div>' +
      '<p style="color:var(--ink-400);font-size:14px">Loading…</p></div></div></div>';
  }

  /** Full-bleed public form, reachable by share token. */
  async function publicForm(token, { embed = false } = {}) {
    crumbs('');
    if (embed) $('.topbar').style.display = 'none';
    loading();
    try {
      const form = await window.Api.getShare(token);
      $('#app').innerHTML = '';
      const host = el('div', null);
      $('#app').appendChild(host);
      window.FF.renderForm(host, form, {
        onSubmitError: (msg) => toast(msg, 'error'),
        onDone: () => toast('Response saved', 'ok'),
      });
      document.title = `${form.title || 'Untitled form'} — FormForge`;
    } catch (err) {
      if (embed) $('.topbar').style.display = '';
      $('#app').innerHTML = '';
      const page = el('div', { class: 'page' },
        el('div', { class: 'card' },
          el('div', { class: 'empty-state' },
            el('h3', null, 'Form not found'),
            el('p', null, 'This share link is invalid, or the form has been deleted.'),
            el('a', { class: 'btn btn-primary', href: '#/' }, 'Go to dashboard'))));
      $('#app').appendChild(page);
    }
  }

  /** Restore the top bar after leaving embed mode. */
  function restoreChrome() {
    const bar = $('.topbar');
    if (bar) bar.style.display = '';
    const main = $('#app');
    if (main && !main.parentElement.classList.contains('topbar') && main.previousElementSibling === bar) {
      // nothing to fix
    }
  }

  function parse() {
    const raw = (window.location.hash || '#/').replace(/^#/, '') || '/';
    const parts = raw.split('/').filter(Boolean);
    return parts;
  }

  function route() {
    restoreChrome();
    const parts = parse();
    if (active && active.dispose) { try { active.dispose(); } catch { /* noop */ } }
    active = null;

    if (parts.length === 0) {
      crumbs('Dashboard');
      document.title = 'FormForge — Open-source form builder';
      active = window.Dashboard.view($('#app'));
      active.render();
      return;
    }

    const [head] = parts;

    if (head === 'new') {
      crumbs('New form');
      window.Builder.createView($('#app'));
      return;
    }

    if (head === 'forms') {
      const id = parseInt(parts[1], 10);
      if (!Number.isInteger(id)) return notFound();
      if (parts.length === 2) {
        crumbs('Builder');
        active = window.Builder.view($('#app'), id);
        active.render();
        return;
      }
      if (parts[2] === 'responses') {
        crumbs('Responses');
        active = window.ResponsesView.view($('#app'), id);
        active.render();
        return;
      }
      return notFound();
    }

    if (head === 's' && parts[1]) {
      publicForm(parts[1]);
      return;
    }

    if (head === 'e' && parts[1]) {
      publicForm(parts[1], { embed: true });
      return;
    }

    notFound();
  }

  function notFound() {
    crumbs('');
    $('#app').innerHTML = '';
    const inner = el('div', { class: 'empty-state' },
      el('h3', null, 'Page not found'),
      el('p', null, 'The link you followed does not exist.'),
      el('a', { class: 'btn btn-primary', href: '#/' }, 'Back to dashboard'));
    $('#app').appendChild(el('div', { class: 'page' }, el('div', { class: 'card' }, inner)));
  }

  /** Remove empty drafts that were auto-created by the builder and never filled. */
  async function cleanupEmptyDraft() {
    const marker = sessionStorage.getItem('ff_just_created');
    if (!marker) return;
    try {
      const form = await window.Api.getForm(Number(marker));
      if (!form || (form.fields || []).length === 0) {
        await window.Api.deleteForm(Number(marker));
      }
    } catch { /* the draft is already gone */ }
    sessionStorage.removeItem('ff_just_created');
  }

  function boot() {
    window.addEventListener('hashchange', route);
    window.addEventListener('pagehide', () => { cleanupEmptyDraft(); }, { once: true });
    route();
  }

  return { boot };
})();

document.addEventListener('DOMContentLoaded', () => window.App.boot());

window.App = App;
