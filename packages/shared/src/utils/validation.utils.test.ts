import { validateCardNumber, detectCardType, validateExpiryDate, validateCvv } from './validation.utils';

describe('validateCardNumber (Luhn algorithm)', () => {
  it('accepts known-valid test card numbers', () => {
    expect(validateCardNumber('4111111111111111')).toBe(true); // Visa
    expect(validateCardNumber('5500000000000004')).toBe(true); // Mastercard
    expect(validateCardNumber('340000000000009')).toBe(true); // Amex
  });

  it('accepts card numbers with spaces', () => {
    expect(validateCardNumber('4111 1111 1111 1111')).toBe(true);
  });

  it('rejects a number that fails the Luhn check', () => {
    expect(validateCardNumber('4111111111111112')).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(validateCardNumber('not-a-card-number')).toBe(false);
  });

  it('rejects numbers outside the 13-19 digit range', () => {
    expect(validateCardNumber('123')).toBe(false);
  });
});

describe('detectCardType', () => {
  it('detects Visa', () => {
    expect(detectCardType('4111111111111111')).toBe('VISA');
  });

  it('detects Mastercard', () => {
    expect(detectCardType('5500000000000004')).toBe('MASTERCARD');
  });

  it('detects Amex', () => {
    expect(detectCardType('340000000000009')).toBe('AMEX');
  });

  it('detects Discover', () => {
    expect(detectCardType('6011000000000004')).toBe('DISCOVER');
  });

  it('returns UNKNOWN for an unrecognized prefix', () => {
    expect(detectCardType('9999999999999999')).toBe('UNKNOWN');
  });
});

describe('validateExpiryDate', () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  it('accepts a future year', () => {
    expect(validateExpiryDate(currentMonth, currentYear + 1)).toBe(true);
  });

  it('accepts the current month/year', () => {
    expect(validateExpiryDate(currentMonth, currentYear)).toBe(true);
  });

  it('rejects a past year', () => {
    expect(validateExpiryDate(currentMonth, currentYear - 1)).toBe(false);
  });

  it('rejects an out-of-range month', () => {
    expect(validateExpiryDate(13, currentYear + 1)).toBe(false);
    expect(validateExpiryDate(0, currentYear + 1)).toBe(false);
  });
});

describe('validateCvv', () => {
  it('requires 4 digits for AMEX', () => {
    expect(validateCvv('1234', 'AMEX')).toBe(true);
    expect(validateCvv('123', 'AMEX')).toBe(false);
  });

  it('requires 3 digits for non-AMEX cards', () => {
    expect(validateCvv('123', 'VISA')).toBe(true);
    expect(validateCvv('1234', 'VISA')).toBe(false);
  });
});
