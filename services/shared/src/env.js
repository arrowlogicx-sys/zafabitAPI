const { z } = require('zod');

// Validate process.env against a zod shape at boot. On failure, print every
// problem and exit(1) — a service should never start half-configured.
const loadEnv = (shape, { name = 'service' } = {}) => {
  const result = z.object(shape).safeParse(process.env);
  if (!result.success) {
    // eslint-disable-next-line no-console
    console.error(`[${name}] invalid environment configuration:`);
    for (const issue of result.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
};

// Common coercions.
const port = (def) => z.coerce.number().int().positive().default(def);
const bool = (def) =>
  z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .or(z.boolean())
    .default(def);
const optionalString = z.string().trim().optional().or(z.literal('')).transform((v) => v || undefined);

module.exports = { loadEnv, z, port, bool, optionalString };
