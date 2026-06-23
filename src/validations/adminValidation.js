const { z } = require('zod');

// Regex to validate standard 24-character MongoDB ObjectID
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = z.string().regex(objectIdRegex, 'Invalid MongoDB ObjectId format');

/**
 * Schema schema for recording manual payments
 * POST /api/v1/admin/payments
 */
const createAdminPaymentSchema = z.object({
  body: z.object({
    customerId: objectIdSchema,
    bookingId: objectIdSchema.optional(),
    amount: z.coerce
      .number({
        invalid_type_error: 'Amount must be a valid number',
      })
      .positive('Amount must be a positive number greater than zero'),
    method: z.enum(['upi', 'card', 'cash', 'netbanking']).default('upi'),
    status: z.enum(['pending', 'captured', 'failed', 'refunded']).default('captured'),
  }),
});

/**
 * Schema schema for wallet adjustments
 * POST /api/v1/admin/wallets/:userId/adjust
 */
const adjustUserWalletSchema = z.object({
  params: z.object({
    userId: objectIdSchema,
  }),
  body: z.object({
    amount: z.coerce
      .number({
        invalid_type_error: 'Adjustment amount must be a number',
      })
      .positive('Adjustment amount must be a positive number greater than zero'),
    type: z.enum(['credit', 'debit']),
    reason: z
      .string({
        required_error: 'Adjustment reason is required',
      })
      .min(3, 'Adjustment reason must be at least 3 characters long'),
  }),
});

module.exports = {
  createAdminPaymentSchema,
  adjustUserWalletSchema,
};
