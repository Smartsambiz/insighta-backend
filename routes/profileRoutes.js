const express = require('express');
const router = express.Router();
const profileController = require('../controllers/ProfileController');
const { authenticate, requireAdmin, requireApiVersion } = require('../middleware/auth');

// Apply to ALL profile routes
router.use(authenticate);
router.use(requireApiVersion);

// Public to all authenticated users
router.get('/profiles/search', profileController.searchProfiles);
router.get('/profiles/export', profileController.exportProfiles);
router.get('/profiles', profileController.getAllProfilesplusFilter);
router.get('/profiles/:id', profileController.getSingleProfiles);

// Admin only
router.post('/profiles', requireAdmin, profileController.getProfiles);
router.delete('/profiles/:id', requireAdmin, profileController.deleteProfile);

module.exports = router;