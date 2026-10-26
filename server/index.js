'use strict';

/**
 * FormForge — an open-source Typeform Pro alternative.
 *
 * Single-process server: Express + SQLite (via Node's built-in node:sqlite).
 * Runs on Node >= 22.5 with one dependency (express).
 */

const express = require('express');
const path = require('node:path');
const { open: openDb, DB_PATH } = require('./db');

const formsRouter = require('./routes/forms');
const responsesRouter = require('./routes/responses');

const PORT = Number(process.env.PORT || 3000);
const LOG_REQUESTS = process.env.LOG_REQUESTS !== '0' && process.env.LOG_REQUESTS !== 'false';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp() {
  openDb();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Request log (quiet, one line). Set LOG_REQUESTS=0 to silence it.
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api') && LOG_REQUESTS) {
      console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
    }
    next();
  });

  // API -----------------------------------------------------------------
  // Note: routers are mounted on prefix-only paths. Mounting a router at a
  // path that contains parameters (e.g. /api/forms/:id/responses) would
  // break req.params extraction and req.url rewriting.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'formforge', version: require('../package.json').version });
  });

  app.use('/api/forms', formsRouter);
  app.use('/api/forms', responsesRouter);

  // 404 for unknown API paths --------------------------------------------
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Frontend SPA ---------------------------------------------------------
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  app.use((req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // Errors ---------------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON body' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log('');
    console.log('  FormForge is running');
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Database: ${DB_PATH}`);
    console.log('');
  });
}

module.exports = { createApp };
