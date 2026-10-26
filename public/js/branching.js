'use strict';

/**
 * Skip logic ("branching") engine.
 *
 * Two mechanisms, both evaluated against the answers collected so far:
 *
 *   1. `field.condition`  — show the field only while the condition holds.
 *   2. `field.next_field_id` — after answering, jump to that field instead of
 *      walking sequentially. Jumps only ever point forward, so a form can never
 *      loop.
 */

const NUMERIC_TYPES = new Set(['number', 'rating', 'scale']);

function isEmptyAnswer(value) {
  return value === undefined || value === null || value === '' ||
    (Array.isArray(value) && value.length === 0);
}

/**
 * Evaluate a condition against the answers collected so far.
 * A missing referenced answer means "unknown" -> the condition fails, so the
 * field is skipped (fail-closed keeps the walk deterministic).
 */
function evaluateCondition(condition, fields, answers) {
  if (!condition || !condition.field_id) return true;
  const ref = fields.find((f) => f.id === condition.field_id);
  if (!ref) return true; // dangling reference: never block a question

  const value = answers[ref.id];
  const op = condition.operator || 'equals';
  const expected = condition.value;

  switch (op) {
    case 'empty':
      return isEmptyAnswer(value);
    case 'not_empty':
      return !isEmptyAnswer(value);
    case 'contains':
      return !isEmptyAnswer(value) && String(value).toLowerCase().includes(String(expected).toLowerCase());

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (isEmptyAnswer(value)) return false;
      const a = NUMERIC_TYPES.has(ref.type) || !Number.isNaN(Number(value)) ? Number(value) : NaN;
      const b = Number(expected);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (op === 'gt') return a > b;
      if (op === 'gte') return a >= b;
      if (op === 'lt') return a < b;
      return a <= b;
    }

    case 'equals': {
      if (isEmptyAnswer(value)) return false;
      if (Array.isArray(value)) return value.map(String).includes(String(expected));
      return String(value) === String(expected);
    }

    case 'not_equals': {
      if (isEmptyAnswer(value)) return true;
      if (Array.isArray(value)) return !value.map(String).includes(String(expected));
      return String(value) !== String(expected);
    }

    default:
      return true;
  }
}

function isShown(field, fields, answers) {
  return !field.condition || evaluateCondition(field.condition, fields, answers);
}

/**
 * Advance to the next field that should be asked.
 * Returns the index into `fields`, or null when the form is complete.
 */
function nextIndex(fields, fromIndex, answers) {
  for (let i = fromIndex; i < fields.length; i++) {
    if (isShown(fields[i], fields, answers)) return i;
  }
  return null;
}

/**
 * Where to go after answering `fields[currentIndex]`.
 * Honours explicit jumps, then falls back to sequential skip logic.
 */
function advanceIndex(fields, currentIndex, answers) {
  const current = fields[currentIndex];

  if (current && current.next_field_id !== null && current.next_field_id !== undefined) {
    const targetIndex = fields.findIndex((f) => f.id === current.next_field_id);
    // Forward-only jumps: a backward jump would loop, so ignore it.
    if (targetIndex > currentIndex && targetIndex < fields.length &&
        isShown(fields[targetIndex], fields, answers)) {
      return targetIndex;
    }
  }

  return nextIndex(fields, currentIndex + 1, answers);
}

/** Fields the respondent will actually see, given current answers. */
function visibleFields(fields, answers) {
  return fields.filter((f) => isShown(f, fields, answers));
}

/** Number of answerable (non-section) fields currently visible. */
function answerableCount(fields, answers) {
  return visibleFields(fields, answers).filter((f) => f.type !== 'section').length;
}

/** Human description for the builder UI. */
function describeCondition(condition, fields) {
  if (!condition) return 'Always show';
  const ref = fields.find((f) => f.id === condition.field_id);
  if (!ref) return 'Broken reference';
  const opMap = {
    equals: 'is',
    not_equals: 'is not',
    gt: 'is more than',
    gte: 'is at least',
    lt: 'is less than',
    lte: 'is at most',
    contains: 'contains',
    empty: 'is empty',
    not_empty: 'is not empty',
  };
  const parts = [`if "${ref.label || ref.type}" ${opMap[condition.operator] || condition.operator}`];
  if (!['empty', 'not_empty'].includes(condition.operator)) {
    parts.push(condition.value);
  }
  return parts.join(' ');
}

window.Branching = {
  evaluateCondition,
  isShown,
  nextIndex,
  advanceIndex,
  visibleFields,
  answerableCount,
  describeCondition,
  NUMERIC_TYPES,
};
