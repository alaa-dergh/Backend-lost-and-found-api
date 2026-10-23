const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, SECRET, { expiresIn: '7d' });
}

function parseToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

// Requires a valid token
function requireAuth(req, res, next) {
  const payload = parseToken(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required (Bearer token)' });
  req.user = { id: payload.sub, email: payload.email };
  next();
}

// Attaches req.user if a token is present, but never rejects
function optionalAuth(req, _res, next) {
  const payload = parseToken(req);
  if (payload) req.user = { id: payload.sub, email: payload.email };
  next();
}

module.exports = { signToken, requireAuth, optionalAuth };
