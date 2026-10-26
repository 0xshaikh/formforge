'use strict';

const express = require('express');
const { db, safeParse, hydrateField } = require('../db');
const { isChoiceType } = require('../validate');

const router = express.Router();

function getFormRow(id) {
  return db.prepare('SELECT * FROM forms WHERE id = ?').get(id);
}

function orderedFields(formId) {
  return db
    .prepare('SELECT * FROM fields WHERE form_id = ? ORDER BY sort_order ASC, id ASC')
    .all(formId)
    .map(hydrateField);
}

// ---------------------------------------------------------------------------
// List + delete
// ---------------------------------------------------------------------------

router.get('/:id/responses', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const form = getFormRow(id);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const fields = orderedFields(id);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 1000);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const rows = db
    .prepare('SELECT * FROM responses WHERE form_id = ? ORDER BY submitted_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(id, limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS n FROM responses WHERE form_id = ?').get(id).n;

  const byId = new Map(fields.map((f) => [f.id, f]));
  res.json({
    total,
    limit,
    offset,
    responses: rows.map((r) => {
      const answers = safeParse(r.answers, {});
      // Render answers in field order, label included for readability.
      const ordered = fields
        .filter((f) => Object.prototype.hasOwnProperty.call(answers, f.id))
        .map((f) => ({
          field_id: f.id,
          label: f.label,
          type: f.type,
          value: answers[f.id],
        }));
      const extras = Object.entries(answers)
        .filter(([k]) => !byId.has(Number(k)))
        .map(([k, v]) => ({ field_id: Number(k), label: '(deleted field)', type: 'text', value: v }));
      return {
        id: r.id,
        submitted_at: r.submitted_at,
        source: r.source,
        answers: ordered.concat(extras),
      };
    }),
  });
});

router.delete('/:id/responses/:responseId', (req, res) => {
  const formId = parseInt(req.params.id, 10);
  const info = db
    .prepare('DELETE FROM responses WHERE id = ? AND form_id = ?')
    .run(parseInt(req.params.responseId, 10), formId);
  if (!info.changes) return res.status(404).json({ error: 'Response not found' });
  res.json({ ok: true, deleted: info.changes });
});

// ---------------------------------------------------------------------------
// Submit — validates against the live field definitions
// ---------------------------------------------------------------------------

router.post('/:id/responses', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const form = getFormRow(id);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  if (!form.published) return res.status(403).json({ error: 'This form is not accepting responses' });

  const body = req.body || {};
  const rawAnswers = body.answers;
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) {
    return res.status(400).json({ error: 'Body must include "answers": { field_id: value }' });
  }

  const errors = [];
  const cleaned = {};
  const fields = orderedFields(id);
  const byId = new Map(fields.map((f) => [f.id, f]));

  for (const field of fields) {
    const key = String(field.id);
    const provided = Object.prototype.hasOwnProperty.call(rawAnswers, key) || Object.prototype.hasOwnProperty.call(rawAnswers, field.id);
    const value = provided ? rawAnswers[key] : rawAnswers[field.id];

    if (field.type === 'section') continue;
    if (!provided || value === '' || (Array.isArray(value) && value.length === 0)) {
      if (field.required) errors.push({ field_id: field.id, label: field.label, error: 'required' });
      continue;
    }

    switch (field.type) {
      case 'text':
      case 'paragraph':
      case 'url':
      case 'phone':
      case 'date': {
        const s = String(value).trim();
        if (!s) {
          if (field.required) errors.push({ field_id: field.id, label: field.label, error: 'required' });
          continue;
        }
        if (field.type === 'url' && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(s)) {
          errors.push({ field_id: field.id, label: field.label, error: 'must be a valid URL' });
          continue;
        }
        const max = field.type === 'paragraph' ? 5000 : 500;
        if (s.length > max) errors.push({ field_id: field.id, label: field.label, error: `too long (max ${max})` });
        else cleaned[field.id] = s;
        break;
      }
      case 'email': {
        const s = String(value).trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) {
          errors.push({ field_id: field.id, label: field.label, error: 'must be a valid email' });
        } else cleaned[field.id] = s;
        break;
      }
      case 'number': {
        const n = Number(value);
        if (!Number.isFinite(n)) errors.push({ field_id: field.id, label: field.label, error: 'must be a number' });
        else cleaned[field.id] = n;
        break;
      }
      case 'yesno': {
        const b = value === true || value === 'true' || value === 1 || value === '1';
        cleaned[field.id] = b;
        break;
      }
      case 'rating':
      case 'scale': {
        const n = Math.trunc(Number(value));
        if (!Number.isInteger(n) || n < 1 || n > 10) {
          errors.push({ field_id: field.id, label: field.label, error: 'must be between 1 and 10' });
        } else cleaned[field.id] = n;
        break;
      }
      case 'radio':
      case 'dropdown': {
        if (!field.options.includes(String(value))) {
          errors.push({ field_id: field.id, label: field.label, error: 'option not in list' });
        } else cleaned[field.id] = String(value);
        break;
      }
      case 'checkboxes': {
        if (!Array.isArray(value)) {
          errors.push({ field_id: field.id, label: field.label, error: 'must be a list' });
        } else {
          const picked = value.map(String).filter((v) => field.options.includes(v));
          if (picked.length === 0) errors.push({ field_id: field.id, label: field.label, error: 'required' });
          else cleaned[field.id] = picked;
        }
        break;
      }
      default:
        cleaned[field.id] = String(value);
    }
  }

  // Ignore answers for fields that no longer exist.
  const final = {};
  for (const [k, v] of Object.entries(cleaned)) {
    if (byId.has(Number(k))) final[Number(k)] = v;
  }

  if (errors.length) {
    return res.status(422).json({ error: 'Validation failed', details: errors });
  }

  const info = db.prepare(
    `INSERT INTO responses (form_id, answers, source, submitted_at)
     VALUES (@form_id, @answers, @source, datetime('now'))`,
  ).run({
    form_id: id,
    answers: JSON.stringify(final),
    source: String(body.source || 'web').slice(0, 30) || 'web',
  });

  res.status(201).json({
    id: Number(info.lastInsertRowid),
    accepted: Object.keys(final).length,
    message: form.success_message || 'Response received',
  });
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

router.get('/:id/responses/analytics', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const form = getFormRow(id);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  // Parse every answer once, then roll each field up.
  const parsed = db.prepare('SELECT answers FROM responses WHERE form_id = ?').all(id).map((r) => safeParse(r.answers, {}));
  const fields = orderedFields(id);
  const fieldsAnswerable = fields.filter((f) => f.type !== 'section');
  const numericTypes = new Set(['number', 'rating', 'scale']);

  const perField = fieldsAnswerable.map((f) => {
    const stat = { field_id: f.id, label: f.label, type: f.type, count: 0 };
    const tally = new Map();
    const texts = [];
    const numbers = [];

    for (const answers of parsed) {
      const v = answers[f.id];
      if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
      stat.count += 1;

      if (isChoiceType(f.type)) {
        for (const vv of (Array.isArray(v) ? v : [v])) {
          const s = String(vv);
          tally.set(s, (tally.get(s) || 0) + 1);
        }
      } else if (typeof v === 'boolean') {
        const label = v ? 'Yes' : 'No';
        tally.set(label, (tally.get(label) || 0) + 1);
      } else if (numericTypes.has(f.type)) {
        numbers.push(Number(v));
      } else {
        texts.push(String(v));
      }
    }

    if (isChoiceType(f.type) || f.type === 'yesno') {
      const options = f.type === 'yesno' ? ['Yes', 'No'] : f.options;
      stat.options = options.map((o) => ({ label: o, count: tally.get(o) || 0 }));
    }
    if (numbers.length) {
      stat.average = +(numbers.reduce((a, b) => a + b, 0) / numbers.length).toFixed(2);
      stat.min = Math.min(...numbers);
      stat.max = Math.max(...numbers);
    }
    if (texts.length) {
      const tally2 = new Map();
      for (const t of texts) tally2.set(t, (tally2.get(t) || 0) + 1);
      stat.unique_values = tally2.size;
      stat.top_values = [...tally2.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([label, count]) => ({ label, count }));
    }
    return stat;
  });

  // Daily volume over the last 14 days.
  const days = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM responses WHERE form_id = ? AND date(submitted_at) = ?")
      .get(id, key).n;
    days.push({ date: key, responses: n });
  }

  res.json({
    form_id: id,
    total_responses: parsed.length,
    fields_answerable: fieldsAnswerable.length,
    completion_rate: fieldsAnswerable.length
      ? +((parsed.reduce((acc, r) => acc + Object.keys(r).length, 0) / (parsed.length || 1) /
          fieldsAnswerable.length) * 100).toFixed(1)
      : 100,
    daily: days,
    fields: perField,
  });
});

module.exports = router;
