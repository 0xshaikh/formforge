'use strict';

/**
 * Shared validation + business logic for form and field payloads.
 */

const VALID_TYPES = [
  'section',
  'text',
  'paragraph',
  'email',
  'number',
  'url',
  'phone',
  'radio',
  'checkboxes',
  'dropdown',
  'rating',
  'scale',
  'yesno',
  'date',
];

const CHOICE_TYPES = new Set(['radio', 'checkboxes', 'dropdown']);
const VALID_THEMES = ['indigo', 'ocean', 'sunset', 'forest', 'grape', 'mono'];

/**
 * Operators available in skip / show logic (branching).
 * Numeric comparisons coerce both sides to numbers.
 */
const VALID_OPERATORS = ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'contains', 'empty', 'not_empty'];

const CLASSIC_DEFAULTS = {
  text: { placeholder: 'Type your answer' },
  paragraph: { placeholder: 'Write your answer' },
  email: { placeholder: 'name@example.com' },
  number: { placeholder: '0' },
  url: { placeholder: 'https://' },
  phone: { placeholder: 'Phone number' },
  date: { placeholder: 'Pick a date' },
};

function isChoiceType(type) {
  return CHOICE_TYPES.has(type);
}

/**
 * Normalise a client-supplied field into a canonical internal shape.
 * Throws on invalid input so callers can return 400.
 */
function normalizeField(input, { existingId = null, formId = null } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const type = typeof source.type === 'string' ? source.type.trim() : '';

  if (!VALID_TYPES.includes(type)) {
    throw new ValidationError(`Unsupported field type: "${type}". Valid types: ${VALID_TYPES.join(', ')}`);
  }

  const label = typeof source.label === 'string' ? source.label.trim() : '';
  if (!label && type !== 'section') {
    throw new ValidationError('Field label is required');
  }
  if (label.length > 300) {
    throw new ValidationError('Field label must be at most 300 characters');
  }

  const placeholder = typeof source.placeholder === 'string' ? source.placeholder.slice(0, 200) : '';
  const helpText = typeof source.help_text === 'string' ? source.help_text.slice(0, 500) : '';
  const required = source.required ? 1 : 0;

  // Options -------------------------------------------------------------
  let options = [];
  if (Array.isArray(source.options)) {
    options = source.options
      .map((o) => {
        if (typeof o === 'string') return o.trim();
        if (o && typeof o === 'object' && typeof o.label === 'string') return o.label.trim();
        if (o && typeof o === 'object' && typeof o.value === 'string') return o.value.trim();
        return '';
      })
      .filter(Boolean)
      .slice(0, 50);
  }
  if (isChoiceType(type) && options.length < 2) {
    throw new ValidationError(`Field type "${type}" needs at least 2 options`);
  }
  if (!isChoiceType(type)) options = [];

  // Skip / show logic ---------------------------------------------------
  let condition = null;
  if (source.condition && typeof source.condition === 'object') {
    const c = source.condition;
    const fieldId = Number(c.field_id ?? c.fieldId);
    const value = c.value;
    const operator = typeof c.operator === 'string' ? c.operator : 'equals';
    const needsValue = !['empty', 'not_empty'].includes(operator);

    if (!Number.isInteger(fieldId) || fieldId <= 0) {
      throw new ValidationError('Condition.field_id must be a positive integer');
    }
    if (!VALID_OPERATORS.includes(operator)) {
      throw new ValidationError(`Invalid condition operator. Valid: ${VALID_OPERATORS.join(', ')}`);
    }
    if (needsValue && (value === undefined || value === null || value === '')) {
      throw new ValidationError('Condition.value is required for this operator');
    }
    if (formId !== null) throwIfConditionPointsAtFuture(formId, fieldId, existingId);
    condition = { field_id: fieldId, operator, value: value === undefined || value === null ? null : String(value).slice(0, 200) };
  }

  // Explicit jump target ------------------------------------------------
  let nextFieldId = null;
  if (source.next_field_id !== undefined && source.next_field_id !== null && source.next_field_id !== '') {
    const n = Number(source.next_field_id);
    if (!Number.isInteger(n) || n <= 0) {
      throw new ValidationError('next_field_id must be a positive integer');
    }
    nextFieldId = n;
  }

  return {
    id: existingId,
    type,
    label,
    placeholder: placeholder || CLASSIC_DEFAULTS[type]?.placeholder || '',
    help_text: helpText,
    required,
    options,
    condition,
    next_field_id: nextFieldId,
  };
}

/** A condition must reference an earlier field so branching can never loop. */
function throwIfConditionPointsAtFuture(formId, fieldId, existingId) {
  const { db } = require('./db');
  const fields = db
    .prepare('SELECT id FROM fields WHERE form_id = ? ORDER BY sort_order ASC, id ASC')
    .all(formId);
  const ids = fields.map((f) => f.id);
  if (!ids.includes(fieldId)) {
    throw new ValidationError(`Condition references field ${fieldId}, which does not exist in this form`);
  }
  const pos = ids.indexOf(fieldId);
  const targetPos = Number.isInteger(existingId) ? ids.indexOf(existingId) : ids.length;
  if (pos >= targetPos) {
    throw new ValidationError('Branching condition must reference an earlier field in the form');
  }
}

function ValidationError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function isValidationError(err) {
  return err && err.status === 400;
}

module.exports = {
  VALID_TYPES,
  VALID_THEMES,
  VALID_OPERATORS,
  isChoiceType,
  normalizeField,
  ValidationError,
  isValidationError,
};
