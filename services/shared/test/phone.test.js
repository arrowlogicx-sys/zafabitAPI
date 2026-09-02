const { canonicalizePhone } = require('../src/phone');

describe('canonicalizePhone', () => {
  it('strips formatting and keeps the leading +', () => {
    expect(canonicalizePhone('+91 99999 00001')).toBe('+919999900001');
    expect(canonicalizePhone('+91-99999-00001')).toBe('+919999900001');
    expect(canonicalizePhone('+91 (99999) 00001')).toBe('+919999900001');
  });

  it('folds "+" and no-"+" forms of the same international number', () => {
    expect(canonicalizePhone('919999900001')).toBe('+919999900001');
    expect(canonicalizePhone('+919999900001')).toBe('+919999900001');
  });

  it('leaves a short local number untouched (no country-code guessing)', () => {
    expect(canonicalizePhone('9999900001')).toBe('9999900001');
  });

  it('returns null for junk / empty / non-string', () => {
    expect(canonicalizePhone('abc')).toBeNull();
    expect(canonicalizePhone('')).toBeNull();
    expect(canonicalizePhone('   ')).toBeNull();
    expect(canonicalizePhone(null)).toBeNull();
    expect(canonicalizePhone(12345)).toBeNull();
  });
});
