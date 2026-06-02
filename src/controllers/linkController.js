const crypto = require('crypto');
const pool = require('../config/db');
const redis = require('../config/redis');

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const generateShortCode = (length = 6) => {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARS[bytes[i] % CHARS.length];
  }
  return code;
};

const isValidUrl = (str) => {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
};

const createLink = async (req, res) => {
  try {
    const { originalUrl, customAlias } = req.body;

    if (!originalUrl || !isValidUrl(originalUrl)) {
      return res.status(400).json({ error: 'Valid URL required' });
    }

    let shortCode;

    if (customAlias) {
      const aliasRegex = /^[a-zA-Z0-9\-_]+$/;
      if (!aliasRegex.test(customAlias)) {
        return res.status(400).json({ error: 'Invalid custom alias' });
      }

      const reserved = ['auth', 'links', 'health', 'login', 'register'];
      if (reserved.includes(customAlias)) {
        return res.status(400).json({ error: 'Reserved alias' });
      }

      const existing = await pool.query(
        'SELECT id FROM links WHERE short_code = $1',
        [customAlias]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Custom alias already exists' });
      }

      shortCode = customAlias;
    } else {
      let isUnique = false;
      while (!isUnique) {
        shortCode = generateShortCode();
        const existing = await pool.query(
          'SELECT id FROM links WHERE short_code = $1',
          [shortCode]
        );
        if (existing.rows.length === 0) {
          isUnique = true;
        }
      }
    }

    await pool.query(
      'INSERT INTO links (user_id, original_url, short_code) VALUES ($1, $2, $3)',
      [req.user.userId, originalUrl, shortCode]
    );

    return res.status(201).json({
      message: 'Link created successfully',
      shortCode,
      originalUrl,
    });
  } catch (error) {
    console.error('Link creation error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getMyLinks = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, short_code, original_url, created_at FROM links WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );

    const links = result.rows.map((row) => ({
      id: row.id,
      shortCode: row.short_code,
      originalUrl: row.original_url,
      createdAt: row.created_at,
    }));

    return res.status(200).json(links);
  } catch (error) {
    console.error('Get links error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getLinkStats = async (req, res) => {
  try {
    const { id } = req.params;

    const linkResult = await pool.query(
      'SELECT id, user_id, short_code, original_url FROM links WHERE id = $1',
      [id]
    );

    if (linkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    const link = linkResult.rows[0];

    if (link.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [clickResult, countryResult, deviceResult] = await Promise.all([
      pool.query(
        'SELECT COUNT(*) AS total_clicks, COUNT(DISTINCT ip_address) AS unique_visitors FROM clicks WHERE link_id = $1',
        [id]
      ),
      pool.query(
        'SELECT country, COUNT(*) AS clicks FROM clicks WHERE link_id = $1 GROUP BY country ORDER BY clicks DESC LIMIT 5',
        [id]
      ),
      pool.query(
        'SELECT device, COUNT(*) AS clicks FROM clicks WHERE link_id = $1 GROUP BY device ORDER BY clicks DESC',
        [id]
      ),
    ]);

    const totalClicks = parseInt(clickResult.rows[0].total_clicks, 10);
    const uniqueVisitors = parseInt(clickResult.rows[0].unique_visitors, 10);

    const topCountries = countryResult.rows.map((row) => ({
      country: row.country,
      clicks: parseInt(row.clicks, 10),
    }));

    const topDevices = deviceResult.rows.map((row) => ({
      device: row.device,
      clicks: parseInt(row.clicks, 10),
    }));

    return res.status(200).json({
      linkId: link.id,
      shortCode: link.short_code,
      originalUrl: link.original_url,
      totalClicks,
      uniqueVisitors,
      topCountries,
      topDevices,
    });
  } catch (error) {
    console.error('Stats error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteLink = async (req, res) => {
  try {
    const { id } = req.params;

    const linkResult = await pool.query(
      'SELECT id, user_id, short_code FROM links WHERE id = $1',
      [id]
    );

    if (linkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    const link = linkResult.rows[0];

    if (link.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await pool.query('DELETE FROM links WHERE id = $1', [id]);

    await redis.del(`url:${link.short_code}`);

    return res.status(200).json({ message: 'Link deleted successfully' });
  } catch (error) {
    console.error('Delete link error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { createLink, getMyLinks, getLinkStats, deleteLink };
