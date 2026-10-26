'use strict';

/**
 * End-to-end API test suite for FormForge.
 *
 *   node test/api.test.js          # boots its own server on an ephemeral port
 *
 * Run against a throwaway database; nothing is persisted to data/.
 */

const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate this run from any real database.
const testDb = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'formforge-test-')),
  'test.db',
);
process.env.FORMFORGE_DB = testDb;
const { createApp } = require('../server');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((err) => {
      failed += 1;
      failures.push({ name, err });
      console.log(`  \u2717 ${name}\n      ${err.message}`);
    });
}

function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const port = server.address().port;
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(buf); } catch { /* not json */ }
          resolve({ status: res.statusCode, body: json, raw: buf, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const SAMPLE_FIELDS = [
  { type: 'section', label: 'Basics' },
  { type: 'text', label: 'First name', placeholder: 'Ada', required: true },
  { type: 'email', label: 'Email', required: true },
  { type: 'radio', label: 'Team size', options: ['Just me', '2-10', '11+'], required: true },
  { type: 'rating', label: 'Satisfaction', required: true },
  { type: 'paragraph', label: 'Anything else?' },
  { type: 'yesno', label: 'Recommend?' },
];

async function main() {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));

  console.log('\nFormForge API tests\n');

  await check('GET /api/health returns ok', async () => {
    const r = await request(server, 'GET', '/api/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.service, 'formforge');
  });

  let formId;
  let fieldIds;

  await check('POST /api/forms creates a form with fields', async () => {
    const r = await request(server, 'POST', '/api/forms', {
      title: 'Launch Feedback',
      description: 'Tell us about launch week.',
      theme: 'ocean',
      success_message: 'Got it, thanks!',
      fields: SAMPLE_FIELDS,
    });
    assert.strictEqual(r.status, 201);
    formId = r.body.id;
    assert.ok(Number.isInteger(formId) && formId > 0);
    assert.strictEqual(r.body.title, 'Launch Feedback');
    assert.strictEqual(r.body.theme, 'ocean');
    assert.strictEqual(r.body.fields.length, SAMPLE_FIELDS.length);
    assert.ok(r.body.share_token, 'share token generated');
    assert.strictEqual(r.body.response_count, 0);
    fieldIds = r.body.fields.map((f) => f.id);
  });

  await check('POST /api/forms rejects a missing title', async () => {
    const r = await request(server, 'POST', '/api/forms', { fields: [] });
    assert.strictEqual(r.status, 400);
  });

  await check('POST /api/forms rejects an unsupported field type', async () => {
    const r = await request(server, 'POST', '/api/forms', { title: 'X', fields: [{ type: 'teleport', label: 'Nope' }] });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /Unsupported field type/);
  });

  await check('GET /api/forms lists the form with counts', async () => {
    const r = await request(server, 'GET', '/api/forms');
    assert.strictEqual(r.status, 200);
    const found = r.body.forms.find((f) => f.id === formId);
    assert.ok(found);
    assert.strictEqual(found.field_count, SAMPLE_FIELDS.length);
  });

  await check('GET /api/forms/types returns metadata', async () => {
    const r = await request(server, 'GET', '/api/forms/types');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.types.includes('rating'));
    assert.ok(r.body.themes.includes('forest'));
  });

  await check('GET /api/forms/share/:token resolves the form', async () => {
    const list = await request(server, 'GET', '/api/forms');
    const token = list.body.forms[0].share_token;
    const r = await request(server, 'GET', `/api/forms/share/${token}`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.id, list.body.forms[0].id);
    assert.ok(Array.isArray(r.body.fields));
    assert.strictEqual((await request(server, 'GET', '/api/forms/share/not-a-real-token')).status, 404);
  });

  let textId, emailId, radioId, ratingId, newRatingId;

  await check('GET /api/forms/:id returns ordered fields', async () => {
    const r = await request(server, 'GET', `/api/forms/${formId}`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.fields.length, 7);
    assert.strictEqual(r.body.fields[3].type, 'radio');
    textId = r.body.fields[1].id;
    emailId = r.body.fields[2].id;
    radioId = r.body.fields[3].id;
    ratingId = r.body.fields[4].id;
  });

  let responseId;
  await check('POST responses accepts a valid submission', async () => {
    const r = await request(server, 'POST', `/api/forms/${formId}/responses`, {
      answers: { [textId]: 'Ada', [emailId]: 'ada@example.com', [radioId]: '2-10', [ratingId]: 5 },
    });
    assert.strictEqual(r.status, 201);
    responseId = r.body.id;
    assert.strictEqual(r.body.accepted, 4);
    assert.strictEqual(r.body.message, 'Got it, thanks!');
  });

  await check('POST responses enforces required fields', async () => {
    const r = await request(server, 'POST', `/api/forms/${formId}/responses`, {
      answers: { [emailId]: 'x@example.com' },
    });
    assert.strictEqual(r.status, 422);
    const labels = r.body.details.map((d) => d.label);
    assert.ok(labels.includes('First name'), `expected First name in ${labels}`);
    assert.ok(labels.includes('Team size'), `expected Team size in ${labels}`);
    assert.ok(labels.includes('Satisfaction'), `expected Satisfaction in ${labels}`);
    assert.ok(!labels.includes('Email'), 'answered email must not be reported missing');
  });

  await check('POST responses rejects malformed email', async () => {
    const r = await request(server, 'POST', `/api/forms/${formId}/responses`, {
      answers: { [textId]: 'A', [emailId]: 'not-an-email', [radioId]: '2-10', [ratingId]: 5 },
    });
    assert.strictEqual(r.status, 422);
    assert.match(r.body.details[0].error, /valid email/);
  });

  await check('POST responses rejects a radio answer outside the option list', async () => {
    const r = await request(server, 'POST', `/api/forms/${formId}/responses`, {
      answers: { [textId]: 'A', [emailId]: 'a@b.co', [radioId]: 'Mars colony', [ratingId]: 5 },
    });
    assert.strictEqual(r.status, 422);
    assert.match(r.body.details[0].error, /option not in list/);
  });

  await check('POST responses rejects a rating out of range', async () => {
    const r = await request(server, 'POST', `/api/forms/${formId}/responses`, {
      answers: { [textId]: 'A', [emailId]: 'a@b.co', [radioId]: '2-10', [ratingId]: 99 },
    });
    assert.strictEqual(r.status, 422);
    assert.match(r.body.details[0].error, /between 1 and 10/);
  });

  await check('POST responses ignores answers for unknown field ids', async () => {
    const r = await request(server, 'POST', `/api/forms/${formId}/responses`, {
      answers: { [textId]: 'A', [emailId]: 'a@b.co', [radioId]: '11+', [ratingId]: 4, 99999: 'ghost' },
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.accepted, 4);
  });

  await check('GET responses returns answers ordered with labels', async () => {
    const r = await request(server, 'GET', `/api/forms/${formId}/responses`);
    assert.strictEqual(r.status, 200);
    // Exactly two submissions succeeded above (the others were rejected with 422).
    assert.strictEqual(r.body.total, 2);
    const newest = r.body.responses[0];
    assert.ok(newest.answers.length >= 4);
    assert.ok(newest.answers.every((a) => a.label));
  });

  await check('PUT /api/forms/:id/fields replaces fields and rewrites ids', async () => {
    const before = await request(server, 'GET', `/api/forms/${formId}`);
    const reordered = before.body.fields.filter((f) => !['paragraph', 'yesno'].includes(f.type));
    const r = await request(server, 'PUT', `/api/forms/${formId}/fields`, { fields: reordered });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.fields.length, 5);
    assert.ok(r.body.fields.every((f) => Number.isInteger(f.id) && f.id > 0));
  });

  await check('PUT fields rewrites branch conditions to the new ids', async () => {
    const r = await request(server, 'GET', `/api/forms/${formId}`);
    const rating = r.body.fields.find((f) => f.type === 'rating');
    const body = r.body.fields.concat({
      type: 'yesno',
      label: 'Recommend?',
      condition: { field_id: rating.id, operator: 'gte', value: 4 },
    });
    const out = await request(server, 'PUT', `/api/forms/${formId}/fields`, { fields: body });
    assert.strictEqual(out.status, 200);
    const yesno = out.body.fields.find((f) => f.type === 'yesno');
    const ratingAfter = out.body.fields.find((f) => f.type === 'rating');
    assert.ok(yesno, 'yesno field must be persisted');
    assert.notStrictEqual(ratingAfter.id, rating.id, 'ids are rewritten on replace');
    assert.deepStrictEqual(
      yesno.condition,
      { field_id: ratingAfter.id, operator: 'gte', value: '4' },
      'the branch must still point at the (new) rating field',
    );
  });

  await check('POST /api/forms/:id/fields appends one field', async () => {
    const before = (await request(server, 'GET', `/api/forms/${formId}`)).body.fields.length;
    const r = await request(server, 'POST', `/api/forms/${formId}/fields`, {
      type: 'number',
      label: 'Budget in USD',
      required: false,
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.type, 'number');
    const after = (await request(server, 'GET', `/api/forms/${formId}`)).body.fields.length;
    assert.strictEqual(after, before + 1);
  });

  let mutableId;
  await check('PATCH /api/forms/fields/:id updates a field in place', async () => {
    // Fresh lookup: field ids change after every bulk replace above.
    const r = await request(server, 'GET', `/api/forms/${formId}`);
    const radio = r.body.fields.find((f) => f.type === 'radio');
    mutableId = radio.id;
    const out = await request(server, 'PATCH', `/api/forms/fields/${mutableId}`, {
      label: 'Company size',
      options: ['Solo', 'Small', 'Large'],
    });
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.body.label, 'Company size');
    assert.deepStrictEqual(out.body.options, ['Solo', 'Small', 'Large']);
  });

  await check('PATCH field rejects fewer than 2 options for a radio', async () => {
    const r = await request(server, 'PATCH', `/api/forms/fields/${mutableId}`, { options: ['Only one'] });
    assert.strictEqual(r.status, 400);
  });

  await check('DELETE field detaches branch conditions that pointed at it', async () => {
    const before = (await request(server, 'GET', `/api/forms/${formId}`)).body.fields;
    const r = await request(server, 'DELETE', `/api/forms/fields/${mutableId}`);
    assert.strictEqual(r.status, 200);
    const after = (await request(server, 'GET', `/api/forms/${formId}`)).body.fields;
    assert.strictEqual(after.length, before.length - 1);
    assert.ok(after.every((f) => !f.condition || f.condition.field_id !== mutableId));
    assert.ok(after.every((f) => f.next_field_id !== mutableId));
  });

  await check('a branch condition cannot reference a later field', async () => {
    const r = await request(server, 'GET', `/api/forms/${formId}`);
    const rating = r.body.fields.find((f) => f.type === 'rating');
    const number = r.body.fields.find((f) => f.type === 'number');
    assert.ok(rating.id < number.id, 'number field must come after rating in this test');
    const out = await request(server, 'PATCH', `/api/forms/fields/${rating.id}`, {
      condition: { field_id: number.id, operator: 'gte', value: 4 },
    });
    assert.strictEqual(out.status, 400);
    assert.match(out.body.error, /earlier field/);
    // The condition must not have been persisted by the failed request.
    const after = (await request(server, 'GET', `/api/forms/${formId}`)).body.fields
      .find((f) => f.id === rating.id);
    assert.strictEqual(after.condition, null);
    newRatingId = after.id;
  });

  await check('a branch condition cannot reference a non-existent field', async () => {
    const r = await request(server, 'PATCH', `/api/forms/fields/${newRatingId}`, {
      condition: { field_id: 424242, operator: 'gte', value: 1 },
    });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /does not exist/);
  });

  await check('an invalid condition operator is rejected', async () => {
    const r = await request(server, 'PATCH', `/api/forms/fields/${newRatingId}`, {
      condition: { field_id: 1, operator: 'fuzzy_match', value: 1 },
    });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /Invalid condition operator/);
  });

  await check('DELETE /api/forms/fields/:id returns 404 for unknown ids', async () => {
    const r = await request(server, 'DELETE', '/api/forms/fields/999999');
    assert.strictEqual(r.status, 404);
  });

  let dupId;
  await check('POST /api/forms/:id/duplicate clones form + fields, not responses', async () => {
    const r = await request(server, 'POST', `/api/forms/${formId}/duplicate`);
    assert.strictEqual(r.status, 201);
    dupId = r.body.id;
    assert.ok(String(r.body.title).includes('(copy)'));
    assert.strictEqual(r.body.fields.length, (await request(server, 'GET', `/api/forms/${formId}`)).body.fields.length);
    assert.strictEqual(r.body.response_count, 0);
    assert.notStrictEqual(r.body.share_token, (await request(server, 'GET', `/api/forms/${formId}`)).body.share_token);
  });

  await check('PATCH /api/forms/:id updates title/theme/published', async () => {
    const r = await request(server, 'PATCH', `/api/forms/${formId}`, {
      title: 'Renamed Survey',
      theme: 'grape',
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.title, 'Renamed Survey');
    assert.strictEqual(r.body.theme, 'grape');
  });

  await check('PATCH /api/forms/:id rejects an unknown theme', async () => {
    const r = await request(server, 'PATCH', `/api/forms/${formId}`, { theme: 'hologram' });
    assert.strictEqual(r.status, 400);
  });


  let analyticsFormId, aRadioId, aRatingId;
  await check('fresh form: submit responses for analytics', async () => {
    const created = await request(server, 'POST', '/api/forms', {
      title: 'Analytics fixture',
      fields: [
        { type: 'radio', label: 'Favourite fruit', options: ['Apple', 'Banana', 'Cherry'] },
        { type: 'rating', label: 'How good?' },
        { type: 'paragraph', label: 'Notes' },
      ],
    });
    assert.strictEqual(created.status, 201);
    analyticsFormId = created.body.id;
    const ids = created.body.fields.map((f) => f.id);
    aRadioId = created.body.fields[0].id;
    aRatingId = created.body.fields[1].id;

    const submits = [
      { [aRadioId]: 'Apple', [aRatingId]: 3, [ids[2]]: 'tasty' },
      { [aRadioId]: 'Apple', [aRatingId]: 4 },
      { [aRadioId]: 'Banana', [aRatingId]: 5, [ids[2]]: 'sweeter please' },
    ];
    for (const answers of submits) {
      const r = await request(server, 'POST', `/api/forms/${analyticsFormId}/responses`, { answers });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    }
  });

  await check('GET analytics aggregates counts, averages and daily volume', async () => {
    const r = await request(server, 'GET', `/api/forms/${analyticsFormId}/responses/analytics`);
    assert.strictEqual(r.status, 200);

    assert.strictEqual(r.body.total_responses, 3);
    assert.strictEqual(r.body.daily.length, 14);
    assert.strictEqual(r.body.daily.reduce((a, d) => a + d.responses, 0), 3);

    const rating = r.body.fields.find((f) => f.type === 'rating');
    assert.ok(rating, 'rating stat missing');
    assert.strictEqual(rating.count, 3);
    assert.strictEqual(rating.average, 4);
    assert.strictEqual(rating.min, 3);
    assert.strictEqual(rating.max, 5);

    const radio = r.body.fields.find((f) => f.type === 'radio');
    assert.ok(radio, 'radio stat missing');
    assert.strictEqual(radio.options.length, 3);
    assert.strictEqual(radio.options.reduce((a, o) => a + o.count, 0), radio.count);
    assert.strictEqual(radio.options.find((o) => o.label === 'Apple').count, 2);

    const notes = r.body.fields.find((f) => f.type === 'paragraph');
    assert.ok(notes, 'paragraph stat missing');
    assert.strictEqual(notes.count, 2);
    assert.ok(Array.isArray(notes.top_values));

    assert.ok(r.body.completion_rate > 0 && r.body.completion_rate <= 100);
  });

  await check('unpublished forms reject submissions but still serve metadata', async () => {
    await request(server, 'PATCH', `/api/forms/${dupId}`, { published: false });
    const sub = await request(server, 'POST', `/api/forms/${dupId}/responses`, { answers: {} });
    assert.strictEqual(sub.status, 403);
    const get = await request(server, 'GET', `/api/forms/${dupId}`);
    assert.strictEqual(get.status, 200);
  });

  await check('DELETE /api/forms/:id cascades to fields and responses', async () => {
    const r = await request(server, 'DELETE', `/api/forms/${dupId}`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await request(server, 'GET', `/api/forms/${dupId}`)).status, 404);
    assert.strictEqual(
      (await request(server, 'GET', `/api/forms/${dupId}/responses`)).status,
      404,
    );
  });

  await check('SPA fallback serves index.html for unknown routes', async () => {
    const r = await request(server, 'GET', '/#/forms/1');
    assert.strictEqual(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
  });

  await check('unknown API paths return JSON 404', async () => {
    const r = await request(server, 'GET', '/api/nope');
    assert.strictEqual(r.status, 404);
    assert.deepStrictEqual(r.body, { error: 'Not found' });
  });

  await check('GET /api/forms/:id returns 404 for unknown ids', async () => {
    assert.strictEqual((await request(server, 'GET', '/api/forms/999999')).status, 404);
  });

  await check('malformed JSON body returns 400', async () => {
    const port = server.address().port;
    const payload = '{"title":';
    const bad = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/forms',
          method: 'POST',
          agent: false,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            let json = null;
            try { json = JSON.parse(buf); } catch { json = null; }
            resolve({ status: res.statusCode, body: json, raw: buf });
          });
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    assert.strictEqual(bad.status, 400, `expected 400, got ${bad.status} (${bad.raw.slice(0, 120)})`);
    assert.strictEqual(bad.body.error, 'Malformed JSON body');
  });

  server.close();
  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.err.stack}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
