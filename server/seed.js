'use strict';

/**
 * Seeds a demo form with branching logic plus a handful of responses.
 *
 *   node server/seed.js
 *   FORMFORGE_DB=./data/formforge.db node server/seed.js
 *
 * Idempotent: it only seeds when the forms table is empty.
 */

const crypto = require('node:crypto');
const { open, db, serializeField, DB_PATH } = require('./db');

function main() {
  open();
  const existing = db.prepare('SELECT COUNT(*) AS n FROM forms').get().n;
  if (existing > 0) {
    console.log(`Database already has ${existing} form(s) — skipping seed.`);
    console.log(`Delete ${DB_PATH} to reset and reseed.`);
    return;
  }

  // ---------------------------------------------------------------- Form --
  const formInfo = db.prepare(
    `INSERT INTO forms (title, description, theme, success_message, published, share_token)
     VALUES (?, ?, ?, ?, 1, ?)`,
  ).run(
    'Customer Onboarding Survey',
    'Find out how teams use our product so we can make it better for them.',
    'indigo',
    'Thanks! Your answers help us ship better features.',
    crypto.randomBytes(16).toString('base64url'),
  );
  const formId = Number(formInfo.lastInsertRowid);

  const raw = [
    { type: 'section', label: 'About you' },
    { type: 'text', label: "What's your first name?", placeholder: 'Ada', required: true },
    { type: 'email', label: 'Work email', placeholder: 'ada@company.com', required: true },
    { type: 'radio', label: 'How big is your team?', required: true,
      options: ['Just me', '2–10', '11–50', '51+'] },
    { type: 'dropdown', label: 'Which region do you work from?', required: true,
      options: ['North America', 'Europe', 'Asia', 'Latin America', 'Africa / Middle East'] },
    { type: 'section', label: 'How you use it' },
    { type: 'checkboxes', label: 'Which features do you rely on?', help_text: 'Pick all that apply', required: true,
      options: ['Forms & surveys', 'Response analytics', 'Embeds', 'API access', 'Team roles'] },
    { type: 'rating', label: 'How satisfied are you overall?', required: true },
    { type: 'paragraph', label: 'What would make this better?', placeholder: 'Tell us anything…' },
    { type: 'yesno', label: 'Would you recommend us to a colleague?' },
  ];

  const created = [];
  for (let i = 0; i < raw.length; i++) {
    const s = serializeField(raw[i]);
    const info = db.prepare(
      `INSERT INTO fields (form_id, type, label, placeholder, help_text, required, options, condition, next_field_id, sort_order)
       VALUES (@form_id, @type, @label, @placeholder, @help_text, @required, @options, @condition, @next_field_id, @sort_order)`,
    ).run({ ...s, form_id: formId, sort_order: i + 1 });
    created.push({ ...raw[i], id: Number(info.lastInsertRowid) });
  }

  // Branching: the recommendation question only appears if satisfaction >= 4.
  const ratingId = created.find((f) => f.type === 'rating').id;
  const recId = created.find((f) => f.type === 'yesno').id;
  db.prepare('UPDATE fields SET condition = ? WHERE id = ?').run(
    JSON.stringify({ field_id: ratingId, operator: 'gte', value: 4 }),
    recId,
  );

  // ------------------------------------------------------------- Responses --
  const fid = (type) => db.prepare('SELECT id FROM fields WHERE form_id = ? AND type = ?').get(formId, type).id;
  const f_name = fid('text');
  const f_email = fid('email');
  const f_team = fid('radio');
  const f_region = fid('dropdown');
  const f_features = fid('checkboxes');
  const f_notes = fid('paragraph');

  const submissions = [
    { [f_name]: 'Ada', [f_email]: 'ada@lovelace.io', [f_team]: '2–10', [f_region]: 'Europe',
      [f_features]: ['Forms & surveys', 'Response analytics'], [ratingId]: 5, [recId]: true },
    { [f_name]: 'Grace', [f_email]: 'grace@hopper.dev', [f_team]: '51+', [f_region]: 'North America',
      [f_features]: ['Forms & surveys', 'API access', 'Team roles'], [ratingId]: 4, [recId]: true },
    { [f_name]: 'Linus', [f_email]: 'linus@kernel.org', [f_team]: 'Just me', [f_region]: 'Europe',
      [f_features]: ['Embeds'], [ratingId]: 2 },
    { [f_name]: 'Margaret', [f_email]: 'margaret@ham.co', [f_team]: '11–50', [f_region]: 'Asia',
      [f_features]: ['Forms & surveys'], [ratingId]: 6, [recId]: true,
      [f_notes]: 'Faster analytics exports would be great.' },
    { [f_name]: 'Alan', [f_email]: 'alan@turing.ai', [f_team]: '2–10', [f_region]: 'Europe',
      [f_features]: ['Forms & surveys', 'Response analytics', 'API access'], [ratingId]: 7, [recId]: true },
    { [f_name]: 'Katherine', [f_email]: 'kat@johnson.space', [f_team]: '11–50', [f_region]: 'North America',
      [f_features]: ['Team roles', 'Embeds'], [ratingId]: 3 },
    { [f_name]: 'Dennis', [f_email]: 'dennis@ritchie.dev', [f_team]: 'Just me', [f_region]: 'North America',
      [f_features]: ['Forms & surveys', 'API access'], [ratingId]: 9, [recId]: true },
  ];

  const insert = db.prepare(
    'INSERT INTO responses (form_id, answers, source) VALUES (?, ?, ?)',
  );
  for (const answers of submissions) insert.run(formId, JSON.stringify(answers), 'web');

  console.log('');
  console.log('Seeded demo data:');
  console.log(`  Form:   ${formId} "Customer Onboarding Survey" (${created.length} fields)`);
  console.log(`  Fields: ${created.map((f) => f.type).join(', ')}`);
  console.log(`  Responses: ${submissions.length}`);
  console.log('');
}

main();
