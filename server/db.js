'use strict';

/**
 * Database layer for FormForge.
 *
 * Uses Node's built-in `node:sqlite` module (Node >= 22.5), so there are no
 * native dependencies to compile and no npm package for storage.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DEFAULT_DB_PATH = process.env.FORMFORGE_DB || path.join(__dirname, '..', 'data', 'formforge.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS forms (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT    NOT NULL,
  description     TEXT    NOT NULL DEFAULT '',
  theme           TEXT    NOT NULL DEFAULT 'indigo',
  success_message TEXT    NOT NULL DEFAULT '',
  published       INTEGER NOT NULL DEFAULT 1,
  share_token     TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fields (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id       INTEGER NOT NULL,
  type          TEXT    NOT NULL,
  label         TEXT    NOT NULL,
  placeholder   TEXT    NOT NULL DEFAULT '',
  help_text     TEXT    NOT NULL DEFAULT '',
  required      INTEGER NOT NULL DEFAULT 0,
  options       TEXT    NOT NULL DEFAULT '[]',
  condition     TEXT    NOT NULL DEFAULT 'null',
  next_field_id INTEGER,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (form_id) REFERENCES forms (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS responses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id      INTEGER NOT NULL,
  answers      TEXT    NOT NULL,
  source       TEXT    NOT NULL DEFAULT 'web',
  submitted_at TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (form_id) REFERENCES forms (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fields_form    ON fields (form_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_responses_form ON responses (form_id, submitted_at);
`;

let db = null;

function open() {
  if (db) return db;

  const dir = path.dirname(DEFAULT_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new DatabaseSync(DEFAULT_DB_PATH);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Serialize a row's JSON columns so the result is plain data. */
function hydrateField(row) {
  if (!row) return row;
  return {
    ...row,
    options: safeParse(row.options, []),
    condition: safeParse(row.condition, null),
    required: !!row.required,
  };
}

function safeParse(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function serializeField(field) {
  return {
    type: String(field.type || 'text'),
    label: String(field.label || ''),
    placeholder: field.placeholder ? String(field.placeholder) : '',
    help_text: field.help_text ? String(field.help_text) : '',
    required: field.required ? 1 : 0,
    options: JSON.stringify(Array.isArray(field.options) ? field.options : []),
    condition: field.condition === null || field.condition === undefined
      ? 'null'
      : JSON.stringify(field.condition),
    next_field_id: field.next_field_id === null || field.next_field_id === undefined
      ? null
      : Number(field.next_field_id),
  };
}

module.exports = {
  open,
  get db() {
    return open();
  },
  hydrateField,
  safeParse,
  serializeField,
  SCHEMA,
  DB_PATH: DEFAULT_DB_PATH,
};
