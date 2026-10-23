const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

app.get('/', (_req, res) => {
  res.json({
    name: 'Lost & Found API',
    version: '1.0.0',
    endpoints: {
      auth: ['POST /auth/register', 'POST /auth/login', 'GET /auth/me'],
      items: [
        'POST /items/lost',
        'POST /items/found',
        'GET /items?q=&type=&category=&status=&location=&date_from=&date_to=&mine=&sort=&page=&limit=',
        'GET /items/:id',
        'PUT|PATCH /items/:id',
        'PATCH /items/:id/recovered',
        'DELETE /items/:id',
      ],
    },
  });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/', routes);

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// Invalid JSON bodies and unexpected errors
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
