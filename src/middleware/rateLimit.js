const rateLimitStore = new Map();

function isRateLimited(req, prefix, maxRequests = 10, windowSeconds = 60) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const key = `${prefix}:${ip}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || entry.window < now) {
    rateLimitStore.set(key, { count: 1, window: now + windowSeconds * 1000 });
    return false;
  }
  entry.count++;
  return entry.count > maxRequests;
}

// Periodic cleanup of expired rate limit entries (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.window < now) {
      rateLimitStore.delete(key);
    }
  }
}, 10 * 60 * 1000);

module.exports = {
  isRateLimited
};
