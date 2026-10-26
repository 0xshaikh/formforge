'use strict';

/**
 * Form builder: edit metadata, manage fields (add / edit / reorder / delete),
 * configure branching, and watch a live preview that renders with the same
 * engine the public form uses.
 */

const Builder = (() => {
  const { el, $, $$, uid, toast, confirmDialog, debounce } = window.FF;
  const { FIELD_TYPES, TYPE_GROUPS, iconFor } = window.Icons;
  const { THEMES } = window.Themes;
  const B = window.Branching;

  const DEFAULTS = {
    title: 'Untitled form',
    description: '',
    theme: 'indigo',
    success_message: 'Thanks for your response!',
    published: true,
  };

  function blankField(type) {
    const t = FIELD_TYPES[type] || FIELD_TYPES.text;
    return {
      key: uid(),
      id: null,
      type,
      label: type === 'section' ? 'New section' : `Your ${t.label.toLowerCase()} question`,
      placeholder: '',
      help_text: '',
      required: type !== 'section',
      options: ['radio', 'checkboxes', 'dropdown'].includes(type)
        ? ['Option 1', 'Option 2']
        : [],
      condition: null,
      next_field_id: null,
    };
  }

  // ----------------------------------------------------------------- create

  async function createView(root) {
    try {
      const form = await window.Api.createForm(DEFAULTS);
      sessionStorage.setItem('ff_just_created', String(form.id));
      window.location.hash = `#/forms/${form.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ------------------------------------------------------------------- view

  function view(root, id) {
    let draft = null;
    let editing = true;

    async function load() {
      root.innerHTML = spinner();
      try {
        draft = await window.Api.getForm(id);
      } catch (err) {
        toast(err.message, 'error');
        setTimeout(() => { window.location.hash = '#/'; }, 900);
        return;
      }
      draft.fields.forEach((f) => { f.key = uid(); });
      draw();
    }

    function spinner() {
      return '<div class="page"><div style="display:grid;place-items:center;min-height:50vh"><div class="spinner"></div></div>';
    }

    // ------------------------------------------------------------ rendering

    function draw() {
      const shareUrl = `${window.location.origin}/#/s/${draft.share_token}`;
      const answerable = draft.fields.filter((f) => f.type !== 'section').length;

      const page = el('div', { class: 'page' },
        el('div', { class: 'page-head' },
          el('div', null,
            el('h1', null, draft.title || 'Untitled form'),
            el('p', { class: 'sub' },
              `${draft.fields.length} fields · ${answerable} questions · ${draft.response_count || 0} responses`)),
          el('div', { class: 'actions' },
            el('button', {
              class: 'btn btn-ghost btn-sm', title: 'Copy share link',
              'aria-label': 'Copy share link',
              html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
              onclick: () => copy(shareUrl),
            }),
            el('a', { class: 'btn btn-outline btn-sm', href: `#/s/${draft.share_token}` },
              'Open'),
            el('a', { class: 'btn btn-outline btn-sm', href: `#/forms/${draft.id}/responses` },
              'Responses'),
            el('button', {
              class: 'btn btn-ghost btn-icon',
              'aria-label': 'Delete form', title: 'Delete form',
              html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
              onclick: onDeleteForm,
            }),
          )),

        el('div', { class: 'builder' },
          el('div', { class: 'builder-side' },
            settingsCard(),
            fieldsCard(),
            addPanel()),

          el('aside', null, preview())));

      root.innerHTML = '';
      root.appendChild(page);
      setPreview(draft, false);
    }

    function settingsCard() {
      const themeSwatches = el('div', { class: 'options-list', style: { flexDirection: 'row', flexWrap: 'wrap', gap: '9px' } },
        ...Object.entries(THEMES).map(([key, t]) =>
          el('button', {
            type: 'button',
            class: `choice${draft.theme === key ? ' sel' : ''}`,
            style: { padding: '8px 12px', borderRadius: '999px', fontSize: '13px', gap: '8px' },
            title: t.label,
            onclick: async () => {
              draft.theme = key;
              await patchForm({ theme: key });
              draw();
            },
          },
            el('span', { class: 'swatch', style: { background: t.accent, width: '14px', height: '14px', borderRadius: '50%', flex: 'none' } }),
            el('span', null, t.label)),
        ));

      return el('section', { class: 'card field-block' },
        el('div', { class: 'field-block-head' },
          el('span', { class: 'field-type-pill' },
            el('span', {
              html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
            }),
            'Form details'),
          el('div', { class: 'spacer' }),
          el('label', { class: 'checkbox' },
            el('input', { type: 'checkbox', checked: draft.published ? 'checked' : null, onchange: onTogglePublish }),
            el('span', null, draft.published ? 'Published' : 'Unpublished'))),

        fieldRow('Title', textInput(draft.title, '', async (v) => {
          draft.title = v || 'Untitled form';
          await patchForm({ title: draft.title });
          draw();
        })),
        fieldRow('Description', textarea(draft.description || '', '', async (v) => {
          draft.description = v;
          await patchForm({ description: v });
        }), 'Shown on the intro screen. Optional.'),
        fieldRow('Theme', themeSwatches),
        fieldRow('Success message', textInput(draft.success_message || '', 'Thanks for your response!', async (v) => {
          draft.success_message = v;
          await patchForm({ success_message: v });
        }), 'Shown after someone submits.'));
    }

    function fieldsCard() {
      return el('section', { class: 'card', style: { padding: '16px' } },
        el('div', { class: 'field-block-head', style: { marginBottom: '12px' } },
          el('h3', { style: { fontSize: '15px' } }, 'Questions'),
          el('div', { class: 'spacer' })),

        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          draft.fields.length === 0
            ? el('p', { style: { color: 'var(--ink-400)', fontSize: '13.5px', padding: '4px' } },
                'No questions yet — add one from the palette below.')
            : draft.fields.map(fieldBlock)));
    }

    function addPanel() {
      const groups = TYPE_GROUPS.map((group) => {
        const types = Object.entries(FIELD_TYPES).filter(([, t]) => t.group === group);
        return el('div', null,
          el('div', { style: { fontSize: '11px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink-400)', margin: '4px 0 7px' } }, group),
          el('div', { class: 'add-grid' },
            ...types.map(([type, t]) => el('button', {
              type: 'button',
              class: 'add-tile',
              title: `Add ${t.label}`,
              html: `${iconFor(type, 18)}<span>${t.label}</span>`,
              onclick: () => addField(type),
            }))));
      });

      return el('section', { class: 'card add-panel' },
        el('div', { class: 'field-block-head', style: { marginBottom: '10px' } },
          el('h3', { style: { fontSize: '15px' } }, 'Add a question'),
          el('div', { class: 'spacer' })),
        ...groups);
    }

    function fieldBlock(field, i) {
      const t = FIELD_TYPES[field.type] || FIELD_TYPES.text;
      const isChoice = ['radio', 'checkboxes', 'dropdown'].includes(field.type);
      const isTextLike = ['text', 'paragraph', 'email', 'url', 'phone', 'number', 'date'].includes(field.type);
      const earlier = draft.fields.slice(0, i);
      const later = draft.fields.slice(i + 1);

      const children = [
        el('div', { class: 'field-block-head' },
          el('span', { class: 'field-type-pill', html: `${iconFor(field.type, 13)}${t.label}` }),
          el('div', { class: 'spacer' }),
          el('button', {
            class: 'btn btn-ghost btn-icon', title: 'Move up', 'aria-label': 'Move up',
            disabled: i === 0 ? '' : null,
            html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
            onclick: () => moveField(i, -1),
          }),
          el('button', {
            class: 'btn btn-ghost btn-icon', title: 'Move down', 'aria-label': 'Move down',
            disabled: i === draft.fields.length - 1 ? '' : null,
            html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
            onclick: () => moveField(i, 1),
          }),
          el('button', {
            class: 'btn btn-ghost btn-icon btn-danger', title: 'Delete field', 'aria-label': 'Delete field',
            html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
            onclick: () => deleteField(i),
          })),

        field.type !== 'section'
          ? fieldRow('Question', textInput(field.label, 'Type your question', (v) => {
              field.label = v;
              saveField(field);
            }))
          : fieldRow('Section title', textInput(field.label, 'Section title', (v) => {
              field.label = v;
              saveField(field);
            })),

        field.type === 'section'
          ? fieldRow('Note', textarea(field.help_text || '', 'Optional note under the title', (v) => {
              field.help_text = v;
              saveField(field);
            }))
          : null,

        isTextLike
          ? fieldRow('Placeholder', textInput(field.placeholder || '', 'Hint shown in the empty field', (v) => {
              field.placeholder = v;
              saveField(field);
            }))
          : null,

        isTextLike
          ? fieldRow('Help text', textarea(field.help_text || '', 'Shown under the question', (v) => {
              field.help_text = v;
              saveField(field);
            }))
          : null,

        isChoice ? optionsEditor(field) : null,

        isTextLike
          ? el('label', { class: 'checkbox', style: { marginTop: '2px' } },
              el('input', { type: 'checkbox', checked: field.required ? 'checked' : null, onchange: () => toggleRequired(field) }),
              el('span', null, 'Required'))
          : isChoice
            ? el('label', { class: 'checkbox', style: { marginTop: '2px' } },
                el('input', { type: 'checkbox', checked: field.required ? 'checked' : null, onchange: () => toggleRequired(field) }),
                el('span', null, 'Required'))
            : null,

        branchingEditor(field, earlier, later),
      ];

      return el('div', { class: 'card field-block' }, ...children);
    }

    function optionsEditor(field) {
      const rows = el('div', { class: 'options-list' },
        ...field.options.map((opt) =>
          el('div', { class: 'option-row' },
            el('span', { class: 'dot' }),
            el('input', {
              class: 'input',
              value: opt,
              'aria-label': 'Option',
              oninput: (e) => {
                const idx = field.options.indexOf(opt);
                field.options[idx] = e.target.value;
                saveField(field);
                setPreview(draft, true);
              },
            }),
            el('button', {
              class: 'btn btn-ghost btn-icon btn-danger', 'aria-label': 'Remove option',
              html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
              onclick: () => {
                field.options = field.options.filter((x) => x !== opt);
                if (field.options.length < 2) field.options = ['Option 1', 'Option 2'];
                draw();
              },
            }),
          )));

      return fieldRow('Options', el('div', null,
        rows,
        el('button', {
          class: 'btn btn-outline btn-sm',
          style: { marginTop: '8px' },
          onclick: () => {
            field.options.push(`Option ${field.options.length + 1}`);
            draw();
          },
        }, '+ Add option')), 'At least two options are required.');
    }

    function branchingEditor(field, earlier, later) {
      const condField = field.condition && field.condition.field_id
        ? draft.fields.find((f) => f.id === field.condition.field_id)
        : null;
      const jumpField = field.next_field_id
        ? draft.fields.find((f) => f.id === field.next_field_id)
        : null;

      const showSelect = el('select', {
        class: 'select',
        onchange: (e) => {
          if (!e.target.value) {
            field.condition = null;
          } else {
            field.condition = { field_id: Number(e.target.value), operator: field.condition?.operator || 'equals', value: field.condition?.value ?? '' };
          }
          draw();
        },
      },
        el('option', { value: '' }, 'Always show'),
        ...earlier.filter((f) => f.type !== 'section').map((f) =>
          el('option', { value: String(f.id), selected: condField && condField.id === f.id ? 'selected' : null },
            f.label || f.type)));

      const opSelect = el('select', {
        class: 'select',
        disabled: condField ? null : '',
        onchange: (e) => {
          if (!field.condition) return;
          field.condition.operator = e.target.value;
          if (['empty', 'not_empty'].includes(e.target.value)) field.condition.value = null;
          else if (field.condition.value === null || field.condition.value === undefined) field.condition.value = '';
          saveField(field);
          draw();
        },
      },
        ...['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_empty', 'empty'].map((op) =>
          el('option', { value: op, selected: field.condition && field.condition.operator === op ? 'selected' : null }, op)));

      const valueInput = el('input', {
        class: 'input',
        placeholder: 'Value',
        value: field.condition && field.condition.value !== null && field.condition.value !== undefined
          ? field.condition.value : '',
        disabled: condField && ['empty', 'not_empty'].includes(condField.operator) ? '' : null,
        oninput: (e) => {
          if (!field.condition) return;
          field.condition.value = e.target.value;
          saveField(field, true);
        },
      });

      const jumpSelect = el('select', {
        class: 'select',
        onchange: (e) => {
          field.next_field_id = e.target.value ? Number(e.target.value) : null;
          saveField(field);
        },
      },
        el('option', { value: '' }, 'Continue in order'),
        ...later.map((f) =>
          el('option', { value: String(f.id), selected: jumpField && jumpField.id === f.id ? 'selected' : null },
            f.label || f.type)));

      const valueRow = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 130px 1fr', gap: '8px' } },
        showSelect, opSelect, valueInput);

      const tip = condField
        ? el('div', { class: 'branch-tip' },
            `${B.describeCondition(field.condition, draft.fields)} — otherwise skip this question.`)
        : el('div', { class: 'branch-tip' }, 'Control which questions this respondent sees.');

      return el('div', { class: `branch-box${condField || jumpField ? '' : ' off'}` },
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          el('span', {
            class: 'field-type-pill',
            style: { background: 'var(--bg-soft)', color: 'var(--ink-500)' },
            html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>',
          },
            'Skip logic'),
          el('div', { class: 'spacer', style: { flex: 1 } }),
          el('div', { class: 'branch-tip' }, tip)),
        valueRow,
        el('div', { style: { display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px', alignItems: 'center' } },
          el('span', { class: 'label', style: { fontSize: '12.5px', fontWeight: 600, color: 'var(--ink-500)' } }, 'After answering'),
          jumpSelect),
      );
    }

    // -------------------------------------------------------------- helpers

    function fieldRow(label, control, help) {
      return el('div', null,
        el('label', { class: 'field-label' }, label),
        control,
        help ? el('p', { class: 'field-help' }, help) : null);
    }

    function textInput(value, placeholder, onInput) {
      return el('input', {
        class: 'input',
        value,
        placeholder,
        oninput: (e) => onInput(e.target.value),
      });
    }

    function textarea(value, placeholder, onInput) {
      return el('textarea', {
        class: 'textarea',
        rows: 2,
        value,
        placeholder,
        oninput: (e) => onInput(e.target.value),
      });
    }

    function preview() {
      return el('div', { class: 'preview-pane' },
        el('div', { class: 'preview-bar' },
          el('span', { class: 'dots' }, el('i'), el('i'), el('i')),
          el('span', { style: { flex: 1 } }, 'Live preview'),
          el('a', { class: 'btn btn-ghost btn-sm', href: `#/s/${draft.share_token}` }, 'Full screen')),
        el('div', { class: 'preview-scroll', id: 'preview-host' }));
    }

    function setPreview(form, instant) {
      const host = $('#preview-host');
      if (!host) return;
      host.innerHTML = '';
      window.FF.renderForm(host, { ...form, fields: form.fields.map((f) => ({ ...f })) }, { embedded: true });
    }

    // --------------------------------------------------------------- actions

    async function patchForm(patch) {
      try {
        const updated = await window.Api.updateForm(draft.id, patch);
        Object.assign(draft, updated);
        return true;
      } catch (err) {
        toast(err.message, 'error');
        return false;
      }
    }

    async function addField(type) {
      const payload = blankField(type);
      const local = { ...payload };
      draft.fields.push(local);
      setPreview(draft, true);
      try {
        const created = await window.Api.addField(draft.id, stripLocal(payload));
        created.key = local.key;
        local.id = created.id;
        local.condition = created.condition;
        local.next_field_id = created.next_field_id;
        draw();
      } catch (err) {
        toast(err.message, 'error');
        draft.fields = draft.fields.filter((f) => f.key !== local.key);
        setPreview(draft, true);
      }
    }

    const saveField = debounce(async (field) => {
      try {
        const updated = await window.Api.updateField(field.id, stripLocal(field));
        field.required = updated.required;
        field.condition = updated.condition;
        field.next_field_id = updated.next_field_id;
        setPreview(draft, true);
      } catch (err) {
        toast(err.message, 'error');
      }
    }, 650);

    async function toggleRequired(field) {
      const next = !field.required;
      field.required = next;
      setPreview(draft, true);
      try {
        const updated = await window.Api.updateField(field.id, { required: next });
        field.required = updated.required;
      } catch (err) {
        field.required = !next;
        toast(err.message, 'error');
      }
    }

    async function moveField(index, dir) {
      const target = index + dir;
      if (target < 0 || target >= draft.fields.length) return;
      const [moved] = draft.fields.splice(index, 1);
      draft.fields.splice(target, 0, moved);
      await persistOrder();
    }

    async function persistOrder() {
      // Optimistic: reorder locally now, persist the whole list right after.
      setPreview(draft, true);
      try {
        const updated = await window.Api.replaceFields(draft.id, draft.fields.map(stripLocal));
        draft.fields = updated.fields.map((f) => ({ ...f, key: f.key || uid() }));
        draw();
      } catch (err) {
        toast(err.message, 'error');
        load();
      }
    }

    async function deleteField(index) {
      const field = draft.fields[index];
      const ok = await confirmDialog({
        title: 'Delete this question?',
        message: `"${field.label || field.type}" and any skip logic that pointed at it will be removed.`,
        confirmText: 'Delete question',
      });
      if (!ok) return;
      try {
        await window.Api.deleteField(field.id);
        draft.fields.splice(index, 1);
        draft = { ...draft, fields: draft.fields };
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    async function onTogglePublish() {
      const next = !draft.published;
      draft.published = next;
      try {
        await patchForm({ published: next });
        draw();
      } catch (err) {
        draft.published = !next;
      }
    }

    async function onDeleteForm() {
      const ok = await confirmDialog({
        title: 'Delete form?',
        message: `This permanently deletes "${draft.title}" and all ${draft.response_count || 0} responses.`,
      });
      if (!ok) return;
      try {
        await window.Api.deleteForm(draft.id);
        sessionStorage.removeItem('ff_just_created');
        toast('Form deleted', 'ok');
        window.location.hash = '#/';
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    function stripLocal(field) {
      const out = {
        type: field.type,
        label: field.label,
        placeholder: field.placeholder || '',
        help_text: field.help_text || '',
        required: !!field.required,
        options: ['radio', 'checkboxes', 'dropdown'].includes(field.type)
          ? field.options.filter(Boolean)
          : [],
        condition: field.condition || null,
        next_field_id: field.next_field_id || null,
      };
      if (field.id !== null && field.id !== undefined) out.id = field.id;
      return out;
    }

    function copy(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => toast('Share link copied', 'ok'), () => toast('Could not copy link', 'error'));
      } else {
        toast('Could not copy link', 'error');
      }
    }

    return { render: load, load };
  }

  return { view, createView };
})();

window.Builder = Builder;
