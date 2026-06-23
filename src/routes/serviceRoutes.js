const express = require('express');
const multer = require('multer');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  getServices,
  getService,
  createService,
  updateService,
  deleteService,
  estimateTime,
  getPolicy,
} = require('../controllers/serviceController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Public routes
router.get('/', getServices);
router.get('/policy', getPolicy);
router.get('/estimate', estimateTime);
router.get('/:id', getService);

// Admin protected routes
router.use(protect);
router.post('/', restrictTo('admin'), upload.single('image'), createService);
router.put('/:id', restrictTo('admin'), upload.single('image'), updateService);
router.delete('/:id', restrictTo('admin'), deleteService);

module.exports = router;
