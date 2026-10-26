'use strict';

/**
 * Live form renderer — the Typeform-style one-question-at-a-time experience.
 *
 *   FF.renderForm(container, form, options)
 *
 * options:
 *   embedded  — render inside a preview pane (compact, no fixed progress bar)
 *   onDone    — callback(value) when the respondent submits
 *   onSubmitError — callback(message)
 */

const FORMVIEW = (() => {
  const { el, $, $$, escapeHtml } = window.FF;
  const { themeOf, themeVars } = window.Themes;
  const B = window.Branching;

  function fieldInput(field, value, onAnswer, autoAdvance, onDone, onSubmit) {
    const set = (v) => onAnswer(v);

    switch (field.type) {
      case 'paragraph': {
        const ta = el('textarea', {
          class: 'textarea',
          placeholder: field.placeholder || 'Write your answer',
          rows: 3,
          'aria-label': field.label,
          oninput: (e) => set(e.target.value),
        });
        if (value !== undefined && value !== null) ta.value = value;
        return ta;
      }

      case 'radio':
      case 'dropdown': {
        const wrap = el('div', { class: 'choices' });
        for (const option of field.options) {
          const btn = el('button', {
            type: 'button',
            class: `choice${value === option ? ' sel' : ''}`,
            'aria-pressed': value === option,
            onclick: () => {
              if (value === option) { set(null); return; }
              set(option);
              if (autoAdvance) setTimeout(() => onDone(), 240);
            },
          },
            field.type === 'radio'
              ? el('span', { class: 'tick' },
                  el('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', html: '<path d="M20 6 9 17l-5-5"/>' }))
              : el('span', { class: 'n' }, field.options.indexOf(option) + 1),
            el('span', null, option),
          );
          wrap.appendChild(btn);
        }
        return wrap;
      }

      case 'checkboxes': {
        const picked = Array.isArray(value) ? [...value] : [];
        const wrap = el('div', { class: 'choices' });
        for (const option of field.options) {
          const isOn = picked.includes(option);
          const btn = el('button', {
            type: 'button',
            class: `choice${isOn ? ' sel' : ''}`,
            'aria-pressed': isOn,
            onclick: () => {
              const next = picked.includes(option)
                ? picked.filter((x) => x !== option)
                : [...picked, option];
              set(next);
            },
          },
            el('span', { class: 'tick ck' },
              el('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', html: '<path d="M20 6 9 17l-5-5"/>' })),
            el('span', null, option),
          );
          wrap.appendChild(btn);
        }
        return wrap;
      }

      case 'rating':
      case 'scale': {
        const max = 10;
        const wrap = el('div', { class: field.type === 'rating' ? 'stars' : 'scale-row' });
        for (let i = 1; i <= max; i++) {
          const on = value === i;
          const btn = el('button', {
            type: 'button',
            class: `star-btn${on ? ' on' : ''}`,
            'aria-label': `${i} out of ${max}`,
            title: String(i),
            onclick: () => {
              set(i);
              if (autoAdvance) setTimeout(() => onDone(), 260);
            },
            html: field.type === 'rating'
              ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8L6.6 19.6l1-6L3.3 9.4l6-.9z"/></svg>'
              : String(i),
          });
          wrap.appendChild(btn);
        }
        return wrap;
      }

      case 'yesno': {
        const wrap = el('div', { class: 'yesno-row' });
        for (const [label, val] of [['Yes', true], ['No', false]]) {
          const btn = el('button', {
            type: 'button',
            class: `yesno-btn${value === val ? ' sel' : ''}`,
            'aria-pressed': value === val,
            onclick: () => {
              set(value === val ? null : val);
              if (autoAdvance) setTimeout(() => onDone(), 220);
            },
            html: `${val
              ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
              : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'}`,
          }, el('span', null, label));
          wrap.appendChild(btn);
        }
        return wrap;
      }

      default: {
        // text, email, url, phone, number, date
        const typeMap = { email: 'email', url: 'url', phone: 'tel', number: 'number', date: 'date' };
        const input = el('input', {
          class: 'input',
          type: typeMap[field.type] || 'text',
          placeholder: field.placeholder || 'Type your answer',
          'aria-label': field.label,
          oninput: (e) => set(e.target.value),
          onkeydown: (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (autoAdvance) onDone();
              else {
                // Enter submits when there is no Next button to press.
                onSubmit();
              }
            }
          },
        });
        if (value !== undefined && value !== null) input.value = value;
        return input;
      }
    }
  }

  // ---- The renderer -----------------------------------------------------

  function render(container, form, options) {
    options = options || {};
    const theme = themeOf(form.theme);
    const fields = form.fields || [];
    const state = { answers: {}, index: null, phase: 'intro', lastField: null };
    const ctx = {}; // per-render scratch (error slot, primary button handle)

    const shell = el('div', { class: 'formshell', style: themeVars(theme) });
    const wrap = el('div', { class: 'formwrap' });
    shell.appendChild(wrap);

    let progress = null;
    if (!options.embedded) {
      progress = el('div', { class: 'progress' });
      shell.appendChild(progress);
    }

    const mount = () => {
      wrap.textContent = '';
      if (state.phase === 'intro') renderIntro();
      else if (state.phase === 'done') renderDone();
      else renderStep();
    };

    function brand() {
      return el('div', { class: 'formbrand' },
        el('img', { src: '/icon.svg', alt: 'FormForge' }),
        el('span', null, 'FormForge'));
    }

    function renderIntro() {
      const answerable = fields.filter((f) => f.type !== 'section');
      wrap.appendChild(brand());
      wrap.appendChild(el('div', { class: 'intro step step-in' },
        el('div', { class: 'kicker' }, form.title ? 'Form' : ''),
        el('h1', null, form.title || 'Untitled form'),
        form.description ? el('p', { class: 'desc' }, form.description) : null,
        el('div', { class: 'start' },
          el('button', {
            class: 'btn btn-primary btn-lg',
            text: answerable.length ? `Start  (${answerable.length})` : 'Start',
            onclick: () => begin(),
          })),
        el('div', { class: 'count' },
          `${answerable.length} question${answerable.length === 1 ? '' : 's'} · ${theme.label} theme`),
      ));
    }

    function begin() {
      const first = B.nextIndex(fields, 0, state.answers);
      if (first === null) return finish();
      state.index = first;
      state.phase = 'step';
      transition(mount);
    }

    function renderDone() {
      const msg = form.success_message || 'Thanks for your response!';
      wrap.appendChild(brand());
      wrap.appendChild(el('div', { class: 'done' },
        el('div', { class: 'ring' },
          el('svg', { width: 40, height: 40, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', html: '<path d="M20 6 9 17l-5-5"/>' })),
        el('h2', null, 'Response sent'),
        el('p', null, msg),
        el('p', { class: 'count', style: { marginTop: '18px', color: 'var(--ink-300)' } },
          `${Object.keys(state.answers).length} answer${Object.keys(state.answers).length === 1 ? '' : 's'} submitted`),
        el('div', { style: { marginTop: 26, display: 'flex', gap: 10, justifyContent: 'center' } },
          el('button', { class: 'btn btn-outline', text: 'Submit another', onclick: () => reset() }),
        ),
      ));
      if (options.onDone) options.onDone(state.answers);
    }

    function renderStep() {
      const field = fields[state.index];
      if (!field) return finish();

      if (!B.isShown(field, fields, state.answers)) {
        const next = B.advanceIndex(fields, state.index, state.answers);
        if (next === null) return finish();
        state.index = next;
        return renderStep();
      }

      state.lastField = field;

      if (field.type === 'section') {
        wrap.appendChild(brand());
        const page = el('div', { class: 'step step-in' });
        page.appendChild(el('div', { class: 'section-title' }, field.label || 'Section'));
        if (field.help_text) page.appendChild(el('div', { class: 'section-note' }, field.help_text));
        page.appendChild(el('div', { class: 'form-nav' },
          el('button', { class: 'btn btn-ghost', onclick: () => goBack() }, '← Back'),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn btn-primary', text: 'Next →', onclick: () => advance() }),
        ));
        wrap.appendChild(page);
        updateProgress();
        return;
      }

      const value = state.answers[field.id];
      const autoAdvance = ['text', 'email', 'url', 'phone', 'number', 'date', 'radio', 'dropdown', 'yesno', 'rating', 'scale'].includes(field.type);
      const input = fieldInput(field, value, (v) => {
        if (v === null || v === undefined || v === '') delete state.answers[field.id];
        else state.answers[field.id] = v;
        errorEl.remove();
        updateProgress();
      }, autoAdvance, doneField, submit);

      wrap.appendChild(brand());
      const page = el('div', { class: 'step step-in' });
      page.appendChild(el('div', { class: 'q-count' }, `Q${state.index + 1} of ${fields.length}`));
      const label = el('div', { class: 'q-label' }, field.label);
      if (field.required) label.appendChild(el('span', { class: 'req' }, ' *'));
      page.appendChild(label);
      if (field.help_text) page.appendChild(el('p', { class: 'q-help' }, field.help_text));
      page.appendChild(el('div', { class: 'answer' }, input));

      const errorEl = el('div', { class: 'form-error', style: { display: 'none' } });
      page.appendChild(errorEl);

      page.appendChild(el('div', { class: 'form-nav' },
        el('button', { class: 'btn btn-ghost', onclick: () => goBack() }, '← Back'),
        el('div', { class: 'spacer' }),
        state.index > 0 ? el('button', { class: 'btn btn-ghost btn-sm', text: 'Skip', onclick: () => skipField() }) : null,
        el('button', {
          class: 'btn btn-primary',
          text: isLast() ? 'Submit' : 'Next →',
          onclick: () => advance(),
        }),
      ));

      ctx.errorEl = errorEl;
      ctx.primaryBtn = page.querySelector('.form-nav .btn-primary');
      wrap.appendChild(page);
      updateProgress();

      // focus the first input so keyboard users are in the flow immediately
      setTimeout(() => {
        const focusable = page.querySelector('input, textarea, select');
        if (focusable && !options.embedded) focusable.focus();
      }, 60);
    }

    function isLast() {
      const next = B.advanceIndex(fields, state.index, state.answers);
      return next === null;
    }

    function error(message) {
      const err = ctx.errorEl;
      if (err) {
        err.textContent = message;
        err.style.display = '';
      }
    }

    function doneField() {
      advance();
    }

    function transition(fn) {
      const current = $('.step', wrap);
      if (current) {
        current.classList.add('step-out');
        setTimeout(fn, 190);
      } else {
        fn();
      }
    }

    function advance() {
      const field = fields[state.index];
      if (!field) return finish();

      if (field.type === 'section') {
        transition(() => {
          const next = B.advanceIndex(fields, state.index, state.answers);
          if (next === null) return finish();
          state.index = next;
          mount();
        });
        return;
      }

      if (field.required && isEmptyAnswer(state.answers[field.id])) {
        error(`${field.label} is required.`);
        return;
      }
      if (!isClientValid(field, state.answers[field.id])) {
        error(formatClientError(field));
        return;
      }

      transition(() => {
        const next = B.advanceIndex(fields, state.index, state.answers);
        if (next === null) { submit(); return; }
        state.index = next;
        mount();
      });
    }

    function goBack() {
      if (state.index === 0) return;
      transition(() => {
        let i = state.index - 1;
        while (i >= 0 && !B.isShown(fields[i], fields, state.answers)) i--;
        if (i < 0) i = 0;
        state.index = i;
        mount();
      });
    }

    function skipField() {
      transition(() => {
        const next = B.advanceIndex(fields, state.index, state.answers);
        if (next === null) return finish();
        state.index = next;
        mount();
      });
    }

    async function submit() {
      if (!isLast() && state.phase === 'step') {
        // Enter key on a non-final question: keep walking instead of sending.
        advance();
        return;
      }
      const btn = ctx.primaryBtn;
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
      }
      try {
        const res = await window.Api.submitResponse(form.id, state.answers, 'web');
        state.phase = 'done';
        transition(mount);
        if (options.onDone) options.onDone(state.answers, res);
      } catch (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = isLast() ? 'Submit' : 'Next →';
        }
        const msg = err.status === 422 && err.data && err.data.details
          ? err.data.details.map((d) => `${d.label}: ${d.error}`).join(' · ')
          : err.message;
        if (options.onSubmitError) options.onSubmitError(msg);
        else error(msg);
      }
    }

    function finish() {
      state.phase = 'done';
      transition(mount);
    }

    function reset() {
      state.answers = {};
      state.index = 0;
      state.phase = 'intro';
      transition(mount);
    }

    function updateProgress() {
      if (!progress) return;
      const answerable = fields.filter((f) => f.type !== 'section');
      const total = Math.max(1, answerable.length);
      const done = state.phase === 'done' ? total : Object.keys(state.answers).length;
      progress.style.width = `${Math.min(100, (done / total) * 100)}%`;
    }

    container.textContent = '';
    container.appendChild(shell);
    mount();
    return {
      get phase() { return state.phase; },
      get answers() { return { ...state.answers }; },
      submit, reset,
    };
  }

  function isEmptyAnswer(v) {
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  }

  function isClientValid(field, value) {
    if (isEmptyAnswer(value)) return true;
    switch (field.type) {
      case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value));
      case 'url': return /^https?:\/\/[^\s]+\.[^\s]+/i.test(String(value));
      case 'number': return Number.isFinite(Number(value));
      case 'rating':
      case 'scale': return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10;
      case 'radio':
      case 'dropdown': return field.options.includes(String(value));
      case 'checkboxes': return Array.isArray(value) && value.length > 0;
      default: return true;
    }
  }

  function formatClientError(field) {
    const hints = {
      email: 'Please enter a valid email address.',
      url: 'Please enter a valid URL (e.g. https://example.com).',
      number: 'Please enter a number.',
      rating: 'Please pick a value between 1 and 10.',
      scale: 'Please pick a value between 1 and 10.',
      radio: 'Please choose one of the listed options.',
      dropdown: 'Please choose one of the listed options.',
      checkboxes: 'Please select at least one option.',
    };
    return hints[field.type] || 'Please check your answer.';
  }

  return { render, isClientValid };
})();

window.FF = window.FF || {};
window.FF.renderForm = FORMVIEW.render;
window.FF.isClientValid = FORMVIEW.isClientValid;
