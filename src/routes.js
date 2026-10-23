const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { signToken, requireAuth, optionalAuth } = require('./auth');

const router = express.Router();

const TYPES = ['lost', 'found'];
const STATUSES = ['open', 'recovered'];
const EDITABLE = ['title', 'description', 'category', 'location', 'date_occurred', 'image_url', 'contact_info'];

const isNonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function publicItem(row) {
  if (!row) return row;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    location: row.location,
    date_occurred: row.date_occurred,
    image_url: row.image_url,
    contact_info: row.contact_info,
    status: row.status,
    recovered_at: row.recovered_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reporter: row.reporter_name ? { id: row.user_id, name: row.reporter_name } : { id: row.user_id },
  };
}

const SELECT_ITEM = `
  SELECT items.*, users.name AS reporter_name
  FROM items JOIN users ON users.id = items.user_id
`;

function getItem(id) {
  return db.prepare(`${SELECT_ITEM} WHERE items.id = ?`).get(id);
}

function validateItemFields(body, { partial }) {
  const errors = [];
  const check = (field, test, msg) => {
    if (body[field] !== undefined && body[field] !== null && !test(body[field])) errors.push(msg);
  };
  if (!partial && !isNonEmpty(body.title)) errors.push('title is required');
  if (partial && body.title !== undefined && !isNonEmpty(body.title)) errors.push('title cannot be empty');
  check('description', (v) => typeof v === 'string', 'description must be a string');
  check('category', (v) => typeof v === 'string', 'category must be a string');
  check('location', (v) => typeof v === 'string', 'location must be a string');
  check('date_occurred', isDate, 'date_occurred must be a valid date (e.g. 2026-10-20)');
  check('image_url', (v) => typeof v === 'string', 'image_url must be a string');
  check('contact_info', (v) => typeof v === 'string', 'contact_info must be a string');
  return errors;
}

/* ------------------------------ Auth ------------------------------ */

router.post('/auth/register', (req, res) => {
  const { name, email, password, phone } = req.body || {};
  const errors = [];
  if (!isNonEmpty(name)) errors.push('name is required');
  if (!isEmail(email)) errors.push('a valid email is required');
  if (typeof password !== 'string' || password.length < 6) errors.push('password must be at least 6 characters');
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  const normalized = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalized)) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)')
    .run(name.trim(), normalized, phone || null, hash);
  const user = { id: info.lastInsertRowid, name: name.trim(), email: normalized, phone: phone || null };
  res.status(201).json({ user, token: signToken(user) });
});

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password are required' });
  }
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const user = { id: row.id, name: row.name, email: row.email, phone: row.phone };
  res.json({ user, token: signToken(user) });
});

router.get('/auth/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id, name, email, phone, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(401).json({ error: 'User no longer exists' });
  res.json({ user: row });
});

/* ------------------------------ Items ------------------------------ */

function createItem(type) {
  return (req, res) => {
    const body = req.body || {};
    const errors = validateItemFields(body, { partial: false });
    if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

    const info = db
      .prepare(
        `INSERT INTO items (user_id, type, title, description, category, location, date_occurred, image_url, contact_info)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        type,
        body.title.trim(),
        body.description ?? null,
        body.category ? body.category.trim().toLowerCase() : null,
        body.location ?? null,
        body.date_occurred ?? null,
        body.image_url ?? null,
        body.contact_info ?? null
      );
    res.status(201).json({ item: publicItem(getItem(info.lastInsertRowid)) });
  };
}

// Report a lost item / report a found item
router.post('/items/lost', requireAuth, createItem('lost'));
router.post('/items/found', requireAuth, createItem('found'));

// Search + filter + paginate
// Query params: q, type, category, status, location, date_from, date_to, mine, page, limit, sort
router.get('/items', optionalAuth, (req, res) => {
  const { q, type, category, status, location, date_from, date_to, mine, sort } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

  if (type && !TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${TYPES.join(', ')}` });
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  if (date_from && !isDate(date_from)) return res.status(400).json({ error: 'date_from must be a valid date' });
  if (date_to && !isDate(date_to)) return res.status(400).json({ error: 'date_to must be a valid date' });

  const where = [];
  const params = [];
  if (q) {
    where.push('(items.title LIKE ? OR items.description LIKE ? OR items.location LIKE ? OR items.category LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (type) { where.push('items.type = ?'); params.push(type); }
  if (category) { where.push('items.category = ?'); params.push(String(category).toLowerCase()); }
  if (status) { where.push('items.status = ?'); params.push(status); }
  if (location) { where.push('items.location LIKE ?'); params.push(`%${location}%`); }
  if (date_from) { where.push('items.date_occurred >= ?'); params.push(date_from); }
  if (date_to) { where.push('items.date_occurred <= ?'); params.push(date_to); }
  if (mine === 'true') {
    if (!req.user) return res.status(401).json({ error: 'Authentication required for mine=true' });
    where.push('items.user_id = ?');
    params.push(req.user.id);
  }

  const orderBy = {
    newest: 'items.created_at DESC, items.id DESC',
    oldest: 'items.created_at ASC, items.id ASC',
    date: 'items.date_occurred DESC, items.id DESC',
  }[sort] || 'items.created_at DESC, items.id DESC';

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM items ${whereSql}`).get(...params).n;
  const rows = db
    .prepare(`${SELECT_ITEM} ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);

  res.json({
    items: rows.map(publicItem),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// Item details
router.get('/items/:id', (req, res) => {
  const row = getItem(req.params.id);
  if (!row) return res.status(404).json({ error: 'Item not found' });
  res.json({ item: publicItem(row) });
});

// Load the item and ensure the caller owns it
function loadOwned(req, res, next) {
  const row = getItem(req.params.id);
  if (!row) return res.status(404).json({ error: 'Item not found' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'You can only modify your own reports' });
  req.item = row;
  next();
}

// Update own report
function updateItem(req, res) {
  const body = req.body || {};
  const errors = validateItemFields(body, { partial: true });
  if (body.status !== undefined) errors.push('use /items/:id/recovered to change status');
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  const sets = [];
  const params = [];
  for (const field of EDITABLE) {
    if (body[field] !== undefined) {
      let value = body[field];
      if (field === 'category' && value) value = value.trim().toLowerCase();
      if (field === 'title') value = value.trim();
      sets.push(`${field} = ?`);
      params.push(value);
    }
  }
  if (!sets.length) return res.status(400).json({ error: `Provide at least one field to update: ${EDITABLE.join(', ')}` });

  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params, req.item.id);
  res.json({ item: publicItem(getItem(req.item.id)) });
}
router.put('/items/:id', requireAuth, loadOwned, updateItem);
router.patch('/items/:id', requireAuth, loadOwned, updateItem);

// Mark as recovered
router.patch('/items/:id/recovered', requireAuth, loadOwned, (req, res) => {
  if (req.item.status === 'recovered') return res.status(409).json({ error: 'Item is already marked as recovered' });
  db.prepare("UPDATE items SET status = 'recovered', recovered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(req.item.id);
  res.json({ item: publicItem(getItem(req.item.id)) });
});

// Delete own report
router.delete('/items/:id', requireAuth, loadOwned, (req, res) => {
  db.prepare('DELETE FROM items WHERE id = ?').run(req.item.id);
  res.status(204).end();
});

module.exports = router;
