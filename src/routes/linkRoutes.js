const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { createLink, getMyLinks, getLinkStats, deleteLink } = require('../controllers/linkController');

router.post('/', auth, createLink);
router.get('/', auth, getMyLinks);
router.get('/:id/stats', auth, getLinkStats);
router.delete('/:id', auth, deleteLink);

module.exports = router;
