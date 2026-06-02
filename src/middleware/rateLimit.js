const redis = require('../config/redis');

const rateLimit = async (req, res, next) => {
  try {
    const ip = req.ip;
    const key = `rate:${ip}`;

    const count = await redis.incr(key);

    console.log(`Rate Limit Count: ${count}`);

    if (count === 1) {
      await redis.expire(key, 60);
    }

    if (count > 10) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    next();
  } catch (error) {
    console.error('Rate limit error:', error.message);
    next();
  }
};

module.exports = rateLimit;
