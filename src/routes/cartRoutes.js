const express = require('express');
const router = express.Router();
const {
  getCart,
  addToCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart,
} = require('../controllers/cartController');
const protect = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', getCart);
router.post('/items', addToCart);
router.post('/items/:itemId', addCartItem);
router.put('/items/:itemId', updateCartItem);
router.delete('/items/:itemId', removeCartItem);
router.delete('/', clearCart);

module.exports = router;
