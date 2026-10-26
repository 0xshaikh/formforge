'use strict';

/** Dashboard: form list, summary stats, create / duplicate / delete / share. */

const Dashboard = (() => {
  const { el, $, $$, escapeHtml, toast, confirmDialog, timeAgo } = window.FF;
  const { THEMES, themeOf } = window.Themes;

  function view(root) {
    let forms = [];

    function set() {
      window.location.hash = '#/';
    }

    async function load() {
      root.innerHTML = '<div class="page"><div style="display:grid;place-items:center;min-height:50vh"><div class="spinner"></div></div></div>';
      try {
        forms = await window.Api.listForms();
      } catch (err) {
        toast(err.message, 'error');
        return;
      }
      draw();
    }

    function draw() {
      const totalResponses = forms.reduce((a, f) => a + (f.response_count || 0), 0);
      const totalFields = forms.reduce((a, f) => a + (f.field_count || 0), 0);
      const published = forms.filter((f) => f.published).length;

      const page = el('div', { class: 'page' },
        el('div', { class: 'page-head' },
          el('div', null,
            el('h1', null, 'Forms'),
            el('p', { class: 'sub' }, forms.length ? 'Everything you are collecting, in one place.' : 'Build your first form to get started.')),
          el('div', { class: 'actions' },
            el('button', {
              class: 'btn btn-primary',
              onclick: () => { window.location.hash = '#/new'; },
            },
              el('span', {
                html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
              }),
              'New form'))),

        el('div', { class: 'stats-row' },
          stat('Forms', String(forms.length), `${published} published`),
          stat('Fields', String(totalFields), `${forms.length ? Math.round(totalFields / forms.length) : 0} avg per form`),
          stat('Responses', String(totalResponses), 'across all forms'),
          stat('Themes', String(Object.keys(THEMES).length), 'built in')),

        forms.length === 0 ? emptyState() : grid(),
      );

      root.innerHTML = '';
      root.appendChild(page);
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    function stat(k, v, d) {
      return el('div', { class: 'stat' },
        el('div', { class: 'k' }, k),
        el('div', { class: 'v' }, v),
        el('div', { class: 'd' }, d));
    }

    function emptyState() {
      return el('div', { class: 'card' },
        el('div', { class: 'empty-state' },
          el('svg', { width: 54, height: 54, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', html: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h4"/>' }),
          el('h3', null, 'No forms yet'),
          el('p', null, 'Create a form, add questions, then share a public link to collect responses.'),
          el('button', { class: 'btn btn-primary btn-lg', onclick: () => window.location.hash = '#/new' },
            'Create your first form')));
    }

    function grid() {
      return el('div', { class: 'forms-grid' },
        ...forms.map(card));
    }

    function card(form) {
      const theme = themeOf(form.theme);
      const shareUrl = `${window.location.origin}/#/s/${form.share_token}`;

      const menu = el('div', { class: 'menu' },
        el('button', {
          class: 'btn btn-ghost btn-icon',
          'aria-label': 'Form actions',
          title: 'Form actions',
          onclick: (e) => {
            e.stopPropagation();
            toggleMenu(menu);
          },
          html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
        }));

      function toggleMenu(node) {
        const existing = $('.menu-pop', node);
        if (existing) {
          existing.remove();
          return;
        }
        const pop = el('div', { class: 'menu-pop' },
          menuItem('Share &amp; embed', '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>', async () => {
            copy(shareUrl);
            toast('Share link copied to clipboard', 'ok');
          }),
          menuItem('Preview form', '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>', () => window.location.hash = `#/s/${form.share_token}`),
          menuItem('Responses', '<path d="M3 3v18h18"/><path d="M7 15v3"/><path d="M11 11v7"/><path d="M15 7v11"/><path d="M19 13v5"/>', () => window.location.hash = `#/forms/${form.id}/responses`),
          menuItem('Duplicate', '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', async () => {
            try {
              await window.Api.duplicateForm(form.id);
              toast('Form duplicated', 'ok');
              load();
            } catch (err) { toast(err.message, 'error'); }
          }),
          menuItem(form.published ? 'Unpublish' : 'Publish', '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/>', async () => {
            try {
              await window.Api.updateForm(form.id, { published: !form.published });
              toast(form.published ? 'Form unpublished' : 'Form published', 'ok');
              load();
            } catch (err) { toast(err.message, 'error'); }
          }),
          menuItem('Delete', '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>', async () => {
            const ok = await confirmDialog({
              title: 'Delete form?',
              message: `"${form.title}" and all of its ${form.response_count || 0} responses will be permanently deleted.`,
            });
            if (!ok) return;
            try {
              await window.Api.deleteForm(form.id);
              toast('Form deleted', 'ok');
              load();
            } catch (err) { toast(err.message, 'error'); }
          }, true));
        node.appendChild(pop);
        setTimeout(() => document.addEventListener('mousedown', function onDown(ev) {
          if (!pop.contains(ev.target) && !node.contains(ev.target)) {
            pop.remove();
            document.removeEventListener('mousedown', onDown);
          }
        }), 0);
      }

      return el('article', {
        class: 'card form-card',
        tabindex: '0',
        role: 'link',
        'aria-label': `Open ${form.title}`,
        onclick: () => window.location.hash = `#/forms/${form.id}`,
        onkeydown: (e) => {
          if (e.key === 'Enter') window.location.hash = `#/forms/${form.id}`;
        },
      },
        el('div', { class: 'title-row' },
          el('div', { class: 'menu' }, menu),
          el('h3', null, form.title || 'Untitled form'),
          el('span', { class: `badge ${form.published ? 'badge-ok' : ''}` },
            form.published ? 'Live' : 'Draft')),
        form.description ? el('p', { class: 'desc' }, form.description) : null,
        el('div', { class: 'meta' },
          el('span', { class: 'swatch', style: { background: theme.accent } }),
          el('span', { class: 'badge' }, theme.label),
          el('span', { class: 'badge' }, `${form.field_count || 0} fields`),
          el('span', { class: 'badge' }, `${form.response_count || 0} responses`)),
        el('div', { class: 'row2' },
          el('span', { style: { fontSize: '12.5px', color: 'var(--ink-400)' } }, `Updated ${timeAgo(form.updated_at)}`),
          el('div', { style: { display: 'flex', gap: 6 } },
            el('a', {
              class: 'btn btn-outline btn-sm', href: `#/s/${form.share_token}`,
              onclick: (e) => e.stopPropagation(),
            }, 'Open'),
            el('a', {
              class: 'btn btn-ghost btn-sm', href: `#/forms/${form.id}/responses`,
              onclick: (e) => e.stopPropagation(),
            }, 'View'))));
    }

    function menuItem(label, iconPath, onClick, danger) {
      return el('button', {
        class: danger ? 'danger' : null,
        onclick: async (e) => {
          e.stopPropagation();
          const pop = e.target.closest('.menu-pop');
          if (pop) pop.remove();
          await onClick();
        },
      },
        el('span', { html: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>` }),
        el('span', null, label));
    }

    function copy(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      } else {
        fallbackCopy(text);
      }
    }
    function fallbackCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* noop */ }
      ta.remove();
    }

    return { render: load, load };
  }

  return { view };
})();

window.Dashboard = Dashboard;
