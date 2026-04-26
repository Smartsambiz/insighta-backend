const { verifyAccessToken } = require('../utils/tokens');

// Checks the Authorization: Bearer <token> header
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Access token required' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload; // { id, role, username }
    next();
  } catch (err) {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }
}

// Checks that user has admin role
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Admin access required' });
  }
  next();
}

// Checks X-API-Version: 1 header
function requireApiVersion(req, res, next) {
  const version = req.headers['x-api-version'];
  if (!version || version !== '1') {
    return res.status(400).json({ status: 'error', message: 'API version header required' });
  }
  next();
}

module.exports = { authenticate, requireAdmin, requireApiVersion };