const express = require('express');
const router = express.Router();
const { UAParser } = require('ua-parser-js');
const geoip = require('geoip-lite');
const pool = require('../config/db');
const redis = require('../config/redis');

const getDeviceType = (userAgent) => {
  if (!userAgent) return 'Unknown';
  const parser = new UAParser(userAgent);
  const type = parser.getDevice().type;
  if (type === 'mobile') return 'Mobile';
  if (type === 'tablet') return 'Tablet';
  if (type) return type.charAt(0).toUpperCase() + type.slice(1);
  return 'Desktop';
};

const getCountry = (ip) => {
  try {
    if (!ip) return 'Unknown';
    const cleanIp = ip.replace(/^::ffff:/, '');
    const geo = geoip.lookup(cleanIp);
    return geo && geo.country ? geo.country : 'Unknown';
  } catch {
    return 'Unknown';
  }
};

router.get('/:shortCode', async (req, res) => {
  try {
    const { shortCode } = req.params;
    const ipAddress = req.ip || null;
    const device = getDeviceType(req.headers['user-agent']);
    const country = getCountry(ipAddress);

    const cachedUrl = await redis.get(`url:${shortCode}`);

    if (cachedUrl) {
      console.log('Redis Cache Hit');
      pool.query(
        'INSERT INTO clicks (link_id, ip_address, device, country, clicked_at) SELECT id, $2, $3, $4, NOW() FROM links WHERE short_code = $1',
        [shortCode, ipAddress, device, country]
      ).catch((err) => console.error('Click tracking error:', err.message));
      return res.redirect(302, cachedUrl);
    }

    console.log('Redis Cache Miss');

    const result = await pool.query(
      'SELECT id, original_url FROM links WHERE short_code = $1',
      [shortCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    const { id: linkId, original_url: originalUrl } = result.rows[0];

    pool.query(
      'INSERT INTO clicks (link_id, ip_address, device, country, clicked_at) VALUES ($1, $2, $3, $4, NOW())',
      [linkId, ipAddress, device, country]
    ).catch((err) => console.error('Click tracking error:', err.message));

    await redis.set(`url:${shortCode}`, originalUrl, 'EX', 3600);

    return res.redirect(302, originalUrl);
  } catch (error) {
    console.error('Redirect error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
