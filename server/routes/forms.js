'use strict';

const express = require('express');
const crypto = require('node:crypto');
const { db, hydrateField, serializeField, safeParse } = require('../db');
const {
  VALID_THEMES,
  VALID_TYPES,
  normalizeField,
} = require('../validate');

const router = express.Router();

const newToken = () => crypto.randomBytes(16).toString('base64url');

const FIELD_COLUMNS = 'form_id, type, label, placeholder, help_text, required, options, condition, next_field_id, sort_order';
const INSERT_FIELD_SQL = `INSERT INTO fields (${FIELD_COLUMNS})
  VALUES (@form_id, @type, @label, @placeholder, @help_text, @required, @options, @condition, @next_field_id, @sort_order)`;

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function getForm(id) {
  const row = db.prepare('SELECT * FROM forms WHERE id = ?').get(id);
  if (!row) return null;
  const fields = db
    .prepare('SELECT * FROM fields WHERE form_id = ? ORDER BY sort_order ASC, id ASC')
    .all(id)
    .map(hydrateField);
  const total = db.prepare('SELECT COUNT(*) AS n FROM responses WHERE form_id = ?').get(id).n;
  return { ...row, fields, response_count: total };
}

function notFound(res) {
  return res.status(404).json({ error: 'Form not found' });
}

function formExists(id) {
  return !!db.prepare('SELECT id FROM forms WHERE id = ?').get(id);
}

/** Shared normalisation for the form-level attributes. */
function normalizeFormAttributes(body, { partial = false } = {}) {
  const out = {};
  if (body.title !== undefined) {
    const t = typeof body.title === 'string' ? body.title.trim() : '';
    if (!t) throw Object.assign(new Error('Form title is required'), { status: 400 });
    if (t.length > 200) throw Object.assign(new Error('Title must be at most 200 characters'), { status: 400 });
    out.title = t;
  }
  if (body.description !== undefined) {
    out.description = typeof body.description === 'string' ? body.description.slice(0, 1000) : '';
  }
  if (body.theme !== undefined) {
    if (!VALID_THEMES.includes(body.theme)) {
      throw Object.assign(new Error(`Invalid theme. Valid themes: ${VALID_THEMES.join(', ')}`), { status: 400 });
    }
    out.theme = body.theme;
  }
  if (body.success_message !== undefined) {
    out.success_message = typeof body.success_message === 'string' ? body.success_message.slice(0, 500) : '';
  }
  if (body.published !== undefined) out.published = body.published ? 1 : 0;
  if (!partial && !out.title) throw Object.assign(new Error('Form title is required'), { status: 400 });
  return out;
}

/** Insert a list of raw field payloads into a form in order. */
function insertFields(formId, rawFields) {
  const rows = [];
  let order = 1;
  for (const raw of rawFields) {
    const f = normalizeField(raw);
    if (f.next_field_id !== null && !rows.some((r) => r.id === f.next_field_id)) {
      f.next_field_id = null; // forward reference to a field not yet inserted
    }
    const info = db.prepare(INSERT_FIELD_SQL).run({
      ...serializeField(f),
      form_id: formId,
      sort_order: order++,
    });
    rows.push({ ...f, id: Number(info.lastInsertRowid) });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Metadata + field routes MUST be registered before /:id so that
// /api/forms/types and /api/forms/fields/:fieldId win over /:id.
// ---------------------------------------------------------------------------

router.get('/types', (req, res) => {
  res.json({ types: VALID_TYPES, themes: VALID_THEMES });
});

/** Resolve a share token to its form (used by the public form pages). */
router.get('/share/:token', (req, res) => {
  const row = db.prepare('SELECT * FROM forms WHERE share_token = ?').get(String(req.params.token).slice(0, 128));
  if (!row) return res.status(404).json({ error: 'Form not found' });
  const fields = db
    .prepare('SELECT * FROM fields WHERE form_id = ? ORDER BY sort_order ASC, id ASC')
    .all(row.id)
    .map(hydrateField);
  const total = db.prepare('SELECT COUNT(*) AS n FROM responses WHERE form_id = ?').get(row.id).n;
  res.json({ ...row, fields, response_count: total });
});

router.patch('/fields/:fieldId', (req, res) => {
  const fieldId = parseInt(req.params.fieldId, 10);
  const existing = db.prepare('SELECT * FROM fields WHERE id = ?').get(fieldId);
  if (!existing) return res.status(404).json({ error: 'Field not found' });
  try {
    const merged = {
      type: existing.type,
      label: existing.label,
      placeholder: existing.placeholder,
      help_text: existing.help_text,
      required: !!existing.required,
      options: safeParse(existing.options, []),
      condition: safeParse(existing.condition, null),
      next_field_id: existing.next_field_id,
    };
    const f = normalizeField({ ...merged, ...(req.body || {}) }, { existingId: fieldId, formId: existing.form_id });
    db.prepare(
      `UPDATE fields SET type = @type, label = @label, placeholder = @placeholder, help_text = @help_text,
        required = @required, options = @options, condition = @condition, next_field_id = @next_field_id
       WHERE id = @id`,
    ).run({ ...serializeField(f), id: fieldId });
    res.json(hydrateField(db.prepare('SELECT * FROM fields WHERE id = ?').get(fieldId)));
  } catch (err) {
    if (err.status === 400) return badRequest(res, err.message);
    throw err;
  }
});

router.delete('/fields/:fieldId', (req, res) => {
  const fieldId = parseInt(req.params.fieldId, 10);
  if (!db.prepare('SELECT id FROM fields WHERE id = ?').get(fieldId)) {
    return res.status(404).json({ error: 'Field not found' });
  }
  // Detach references so branching never points at a deleted field.
  db.prepare('UPDATE fields SET next_field_id = NULL WHERE next_field_id = ?').run(fieldId);
  const candidates = db
    .prepare('SELECT id, condition FROM fields WHERE form_id = (SELECT form_id FROM fields WHERE id = ?)')
    .all(fieldId);
  for (const r of candidates) {
    const cond = safeParse(r.condition, null);
    if (cond && cond.field_id === fieldId) {
      db.prepare("UPDATE fields SET condition = 'null' WHERE id = ?").run(r.id);
    }
  }
  db.prepare('DELETE FROM fields WHERE id = ?').run(fieldId);
  res.json({ ok: true, deleted: fieldId });
});

// ---------------------------------------------------------------------------
// Form CRUD
// ---------------------------------------------------------------------------

router.get('/', (req, res) => {
  const forms = db.prepare('SELECT * FROM forms ORDER BY updated_at DESC, id DESC').all();
  const counts = new Map(
    db.prepare('SELECT form_id, COUNT(*) AS n FROM responses GROUP BY form_id').all().map((r) => [r.form_id, r.n]),
  );
  const fieldCounts = new Map(
    db.prepare('SELECT form_id, COUNT(*) AS n FROM fields GROUP BY form_id').all().map((r) => [r.form_id, r.n]),
  );
  res.json({
    forms: forms.map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      theme: f.theme,
      published: !!f.published,
      share_token: f.share_token,
      created_at: f.created_at,
      updated_at: f.updated_at,
      response_count: counts.get(f.id) || 0,
      field_count: fieldCounts.get(f.id) || 0,
    })),
  });
});

router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const attrs = normalizeFormAttributes(body);
    const info = db.prepare(
      `INSERT INTO forms (title, description, theme, success_message, published, share_token)
       VALUES (@title, @description, @theme, @success_message, @published, @share_token)`,
    ).run({
      title: attrs.title,
      description: attrs.description ?? '',
      theme: attrs.theme ?? 'indigo',
      success_message: attrs.success_message ?? '',
      published: attrs.published === undefined ? 1 : attrs.published,
      share_token: newToken(),
    });
    const id = Number(info.lastInsertRowid);
    if (Array.isArray(body.fields)) insertFields(id, body.fields);
    res.status(201).json(getForm(id));
  } catch (err) {
    if (err.status === 400) return badRequest(res, err.message);
    throw err;
  }
});

router.get('/:id', (req, res) => {
  const form = getForm(parseInt(req.params.id, 10));
  if (!form) return notFound(res);
  res.json(form);
});

router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!formExists(id)) return notFound(res);
  try {
    const attrs = normalizeFormAttributes(req.body || {}, { partial: true });
    if (!Object.keys(attrs).length) return res.json(getForm(id));
    const keys = Object.keys(attrs).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE forms SET ${keys}, updated_at = datetime('now') WHERE id = @id`).run({ ...attrs, id });
    res.json(getForm(id));
  } catch (err) {
    if (err.status === 400) return badRequest(res, err.message);
    throw err;
  }
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM forms WHERE id = ?').run(parseInt(req.params.id, 10));
  if (!info.changes) return notFound(res);
  res.json({ ok: true, deleted: info.changes });
});

router.post('/:id/duplicate', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const source = db.prepare('SELECT * FROM forms WHERE id = ?').get(id);
  if (!source) return notFound(res);
  const fields = db
    .prepare('SELECT * FROM fields WHERE form_id = ? ORDER BY sort_order ASC, id ASC')
    .all(id)
    .map(hydrateField);

  const info = db.prepare(
    `INSERT INTO forms (title, description, theme, success_message, published, share_token)
     VALUES (@title, @description, @theme, @success_message, @published, @share_token)`,
  ).run({
    title: `${source.title} (copy)`.slice(0, 200),
    description: source.description,
    theme: source.theme,
    success_message: source.success_message,
    published: source.published,
    share_token: newToken(),
  });
  insertFields(Number(info.lastInsertRowid), fields);
  res.status(201).json(getForm(Number(info.lastInsertRowid)));
});

// ---------------------------------------------------------------------------
// Fields on a form
// ---------------------------------------------------------------------------

/** PUT /api/forms/:id/fields — atomically replace the whole field list. */
router.put('/:id/fields', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!formExists(id)) return notFound(res);
  const raw = req.body && req.body.fields;
  if (!Array.isArray(raw)) return badRequest(res, 'Request body must be { "fields": [...] }');

  try {
    const remap = new Map();
    const prepared = raw.map((item, i) => {
      const norm = normalizeField(item, { existingId: Number(item && item.id), formId: id });
      return { ...norm, sort_order: i + 1 };
    });

    const created = prepared.map((f) => {
      const info = db.prepare(INSERT_FIELD_SQL).run({
        ...serializeField(f),
        form_id: id,
        sort_order: f.sort_order,
      });
      const newId = Number(info.lastInsertRowid);
      if (Number.isInteger(f.id) && f.id > 0) remap.set(f.id, newId);
      return { ...f, id: newId };
    });

    // Rewrite conditions/jumps with the new ids; drop dangling references.
    for (const f of created) {
      let condition = f.condition;
      if (condition) {
        const target = remap.get(condition.field_id);
        condition = target === undefined ? null : { ...condition, field_id: target };
      }
      const next = f.next_field_id === null ? null : remap.get(f.next_field_id);
      db.prepare('UPDATE fields SET condition = ?, next_field_id = ? WHERE id = ?').run(
        condition ? JSON.stringify(condition) : 'null',
        next,
        f.id,
      );
    }

    const keep = new Set(created.map((c) => c.id));
    for (const row of db.prepare('SELECT id FROM fields WHERE form_id = ?').all(id)) {
      if (!keep.has(row.id)) db.prepare('DELETE FROM fields WHERE id = ?').run(row.id);
    }
    db.prepare("UPDATE forms SET updated_at = datetime('now') WHERE id = ?").run(id);
    res.json(getForm(id));
  } catch (err) {
    if (err.status === 400) return badRequest(res, err.message);
    throw err;
  }
});

router.post('/:id/fields', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!formExists(id)) return notFound(res);
  try {
    const f = normalizeField(req.body || {});
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM fields WHERE form_id = ?').get(id).n;
    const info = db.prepare(INSERT_FIELD_SQL).run({
      ...serializeField(f),
      form_id: id,
      sort_order: maxOrder + 1,
    });
    res.status(201).json(hydrateField(db.prepare('SELECT * FROM fields WHERE id = ?').get(info.lastInsertRowid)));
  } catch (err) {
    if (err.status === 400) return badRequest(res, err.message);
    throw err;
  }
});

module.exports = router;
module.exports.getForm = getForm;
module.exports.insertFields = insertFields;
