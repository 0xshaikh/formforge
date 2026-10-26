'use strict';

/** Responses viewer + analytics (insights) for a single form. */

const ResponsesView = (() => {
  const { el, $, toast, confirmDialog, timeAgo } = window.FF;
  const { THEMES, themeOf, themeVars } = window.Themes;

  function valueCell(value) {
    if (value === null || value === undefined || value === '') {
      return el('span', { style: { color: 'var(--ink-300)' } }, '—');
    }
    if (Array.isArray(value)) {
      return el('div', { class: 'chips' }, ...value.map((v) => el('span', { class: 'chip' }, String(v))));
    }
    if (typeof value === 'boolean') {
      return el('span', { class: 'chip', style: value ? null : { background: 'var(--bg-soft)', color: 'var(--ink-500)' } }, value ? 'Yes' : 'No');
    }
    return el('span', { class: 'resp-val' }, String(value));
  }

  function view(root, id) {
    let form = null;
    let responses = null;
    let analytics = null;
    let tab = 'responses';

    async function load() {
      root.innerHTML = '<div class="page"><div style="display:grid;place-items:center;min-height:50vh"><div class="spinner"></div></div></div>';
      try {
        const [f, r, a] = await Promise.all([
          window.Api.getForm(id),
          window.Api.listResponses(id, { limit: 200 }),
          window.Api.analytics(id),
        ]);
        form = f; responses = r; analytics = a;
      } catch (err) {
        toast(err.message, 'error');
        setTimeout(() => { window.location.hash = '#/'; }, 900);
        return;
      }
      draw();
    }

    function draw() {
      const theme = themeOf(form.theme);
      const page = el('div', { class: 'page' },
        el('div', { class: 'page-head' },
          el('div', null,
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
              el('span', { class: 'swatch', style: { background: theme.accent, width: '12px', height: '12px', borderRadius: '4px' } }),
              el('h1', null, form.title || 'Untitled form')),
            el('p', { class: 'sub' },
              `${form.fields.length} fields · updated ${timeAgo(form.updated_at)}`)),
          el('div', { class: 'actions' },
            el('a', { class: 'btn btn-outline btn-sm', href: `#/forms/${form.id}` }, 'Edit form'),
            el('a', { class: 'btn btn-primary btn-sm', href: `#/s/${form.share_token}` }, 'Open form'))),

        el('div', { class: 'tabs' },
          tabBtn('responses', 'Responses', responses ? responses.total : 0),
          tabBtn('insights', 'Insights', null)),

        tab === 'responses' ? responsesTab() : insightsTab());

      root.innerHTML = '';
      root.appendChild(page);
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    function tabBtn(key, label, count) {
      return el('button', {
        class: `tab${tab === key ? ' active' : ''}`,
        onclick: () => { tab = key; draw(); },
      }, label, count !== null ? el('span', { class: 'badge', style: { marginLeft: '7px' } }, String(count)) : null);
    }

    // ----------------------------------------------------------- responses

    function responsesTab() {
      const total = responses.total;
      if (total === 0) {
        return el('div', { class: 'card' },
          el('div', { class: 'empty-state' },
            el('h3', null, 'No responses yet'),
            el('p', null, 'Share the form link and responses will appear here instantly.'),
            el('a', { class: 'btn btn-primary', href: `#/s/${form.share_token}` }, 'Open the form')));
      }

      const rows = responses.responses.map((r) =>
        el('tr', null,
          el('td', null, el('span', { style: { fontFamily: 'var(--mono)', fontSize: '12.5px', color: 'var(--ink-400)' } }, `#${r.id}`)),
          el('td', null, el('span', { style: { whiteSpace: 'nowrap', color: 'var(--ink-400)', fontSize: '13px' } }, timeAgo(r.submitted_at))),
          ...form.fields.filter((f) => f.type !== 'section').map((f) => {
            const answer = r.answers.find((a) => a.field_id === f.id);
            return el('td', null, answer ? valueCell(answer.value) : el('span', { style: { color: 'var(--ink-300)' } }, '—'));
          }),
          el('td', null, el('button', {
            class: 'btn btn-ghost btn-icon btn-danger',
            'aria-label': 'Delete response', title: 'Delete response',
            html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
            onclick: () => onDelete(r.id),
          })),
        ));

      const headerCells = [el('th', null, 'ID'), el('th', null, 'Submitted')];
      form.fields.filter((f) => f.type !== 'section').forEach((f) => headerCells.push(
        el('th', { style: { maxWidth: '190px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.label || f.type)));
      headerCells.push(el('th', null));

      return el('div', { class: 'scroll-x' },
        el('table', { class: 'resp-table' },
          el('thead', null, el('tr', null, ...headerCells)),
          el('tbody', null, ...rows)));
    }

    async function onDelete(responseId) {
      const ok = await confirmDialog({
        title: 'Delete this response?',
        message: `Response #${responseId} will be permanently removed.`,
        confirmText: 'Delete response',
      });
      if (!ok) return;
      try {
        await window.Api.deleteResponse(form.id, responseId);
        toast('Response deleted', 'ok');
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    // ------------------------------------------------------------ insights

    function insightsTab() {
      const last7 = analytics.daily.slice(-7).reduce((a, d) => a + d.responses, 0);

      return el('div', null,
        el('div', { class: 'kpi-grid' },
          kpi('Total responses', String(analytics.total_responses), `${last7} in the last 7 days`),
          kpi('Questions answered', String(analytics.fields_answerable), `across ${form.fields.length} fields`),
          kpi('Completion rate', `${analytics.completion_rate}%`, 'average answers per respondent'),
          kpi('Responses this week', String(last7), 'new submissions')),

        el('div', { class: 'card', style: { padding: '20px', marginBottom: '18px' } },
          el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '14px' } },
            el('h3', { style: { fontSize: '16px' } }, 'Responses over time'),
            el('span', { style: { fontSize: '12.5px', color: 'var(--ink-400)', fontWeight: 500 } }, 'last 14 days')),
          sparkline(analytics.daily)),

        analytics.fields.length === 0
          ? el('div', { class: 'card' },
              el('div', { class: 'empty-state' },
                el('h3', null, 'No data yet'),
                el('p', null, 'Once responses come in, per-question breakdowns appear here.')))
          : el('div', { style: { display: 'grid', gap: '16px' } },
              analytics.fields.map(fieldInsight)));
    }

    function kpi(k, v, d) {
      return el('div', { class: 'stat' },
        el('div', { class: 'k' }, k),
        el('div', { class: 'v' }, v),
        el('div', { class: 'd' }, d));
    }

    function sparkline(days) {
      const w = 640, h = 120, pad = 6;
      const max = Math.max(1, ...days.map((d) => d.responses));
      const step = (w - pad * 2) / (days.length - 1 || 1);
      const pts = days.map((d, i) => [pad + i * step, h - pad - (d.responses / max) * (h - pad * 2)]);
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;
      const accent = themeOf(form.theme).accent;

      return el('div', {
        html: `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Responses per day">
          <defs><linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${accent}" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
          </linearGradient></defs>
          <path d="${area}" fill="url(#sparkfill)"/>
          <path d="${line}" fill="none" stroke="${accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          ${pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${days[i].responses ? 3.4 : 2}" fill="${days[i].responses ? accent : '#c9ced8'}"/>`).join(' ')}
        </svg>`,
      });
    }

    function fieldInsight(stat) {
      const accent = themeOf(form.theme).accent;

      let body;
      if (Array.isArray(stat.options)) {
        const total = stat.options.reduce((a, o) => a + o.count, 0) || 1;
        const maxCount = Math.max(1, ...stat.options.map((o) => o.count));
        body = el('div', null, ...stat.options.map((o) =>
          el('div', { class: 'bar-row' },
            el('div', { class: 'bar-lbl', title: o.label }, o.label),
            el('div', { class: 'bar-track' },
              el('div', {
                class: 'bar-fill',
                style: { width: `${(o.count / maxCount) * 100}%`, background: `linear-gradient(90deg, ${accent}, ${themeOf(form.theme).accent600})` },
              })),
            el('div', { class: 'bar-val' }, `${o.count}`)),
          ));
      } else if (stat.average !== undefined) {
        body = el('div', null,
          el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px' } },
            el('div', { style: { fontSize: '34px', fontWeight: 700, color: 'var(--ink-900)', letterSpacing: '-0.03em' } }, String(stat.average)),
            el('div', { style: { color: 'var(--ink-400)', fontSize: '13.5px' } }, `average · range ${stat.min}–${stat.max}`)),
          el('div', { class: 'bar-track' },
            el('div', { class: 'bar-fill', style: { width: `${(stat.average / 10) * 100}%` } })));
      } else if (Array.isArray(stat.top_values)) {
        const maxCount = Math.max(1, ...stat.top_values.map((t) => t.count));
        body = el('div', null, ...stat.top_values.map((t) =>
          el('div', { class: 'bar-row' },
            el('div', { class: 'bar-lbl', title: t.label }, t.label),
            el('div', { class: 'bar-track' },
              el('div', { class: 'bar-fill', style: { width: `${(t.count / maxCount) * 100}%` } })),
            el('div', { class: 'bar-val' }, `${t.count}`)),
          ));
      } else {
        body = el('p', { style: { color: 'var(--ink-400)', fontSize: '13.5px' } }, 'No answers recorded yet.');
      }

      return el('div', { class: 'card', style: { padding: '18px 20px' } },
        el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '13px' } },
          el('h3', { style: { fontSize: '15.5px' } }, stat.label),
          el('span', { class: 'badge' }, stat.type),
          el('div', { class: 'spacer', style: { flex: 1 } }),
          el('span', { style: { fontSize: '12.5px', color: 'var(--ink-400)' } }, `${stat.count} answered`)),
        body);
    }

    return { render: load, load };
  }

  return { view };
})();

window.ResponsesView = ResponsesView;
