// Canonicalise a phone number so the same real number in different formats
// ("+91 99999 00001", "+919999900001", "9999900001") maps to one identity,
// one OTP state, and one rate-limit bucket. We do NOT guess a country code:
// a value with no "+" and fewer than 11 digits is left as-is (the app always
// sends E.164 with the country code from its picker).
const canonicalizePhone = (raw) => {
  if (typeof raw !== 'string') return null;
  const hadPlus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return hadPlus || digits.length >= 11 ? `+${digits}` : digits;
};

module.exports = { canonicalizePhone };
