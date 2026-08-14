import {
  generateHmacSignature,
  verifyHmacSignature,
  generateApiKey,
  maskCardNumber,
  hashData,
  encrypt,
  decrypt,
} from './crypto.utils';

describe('HMAC signing', () => {
  const secret = 'test-secret';
  const payload = JSON.stringify({ amount: 100, currency: 'USD' });

  it('produces a signature that verifies against the same payload and secret', () => {
    const signature = generateHmacSignature(payload, secret);
    expect(verifyHmacSignature(payload, signature, secret)).toBe(true);
  });

  it('is deterministic for the same payload and secret', () => {
    expect(generateHmacSignature(payload, secret)).toBe(generateHmacSignature(payload, secret));
  });

  it('rejects a signature if the payload was tampered with', () => {
    const signature = generateHmacSignature(payload, secret);
    const tamperedPayload = JSON.stringify({ amount: 999999, currency: 'USD' });
    expect(verifyHmacSignature(tamperedPayload, signature, secret)).toBe(false);
  });

  it('rejects a signature generated with a different secret', () => {
    const signature = generateHmacSignature(payload, 'wrong-secret');
    expect(verifyHmacSignature(payload, signature, secret)).toBe(false);
  });

  it('returns false (not throw) for a tampered signature of a different length', () => {
    const signature = generateHmacSignature(payload, secret);
    // A naive crypto.timingSafeEqual call throws RangeError on length
    // mismatch instead of returning false - this is exactly the shape a
    // tampered signature usually takes.
    expect(() => verifyHmacSignature(payload, `${signature}tampered`, secret)).not.toThrow();
    expect(verifyHmacSignature(payload, `${signature}tampered`, secret)).toBe(false);
  });
});

describe('encrypt / decrypt (AES-256-GCM)', () => {
  // 32 bytes -> 64 hex chars, as required by crypto.utils' key handling
  const key = 'a'.repeat(64);

  it('round-trips plaintext through encrypt then decrypt', () => {
    const plaintext = 'sensitive-card-data-4111111111111111';
    const encrypted = encrypt(plaintext, key);
    expect(decrypt(encrypted, key)).toBe(plaintext);
  });

  it('produces different ciphertext on each call due to a random IV', () => {
    const plaintext = 'same-input';
    expect(encrypt(plaintext, key)).not.toBe(encrypt(plaintext, key));
  });

  it('fails to decrypt with the wrong key', () => {
    const encrypted = encrypt('secret-value', key);
    const wrongKey = 'b'.repeat(64);
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it('throws on a malformed encrypted string', () => {
    expect(() => decrypt('not-a-valid-format', key)).toThrow('Invalid encrypted text format');
  });
});

describe('maskCardNumber', () => {
  it('masks all but the last 4 digits', () => {
    expect(maskCardNumber('4111111111111111')).toBe('************1111');
  });

  it('returns a fixed mask for strings shorter than 4 characters', () => {
    expect(maskCardNumber('12')).toBe('****');
  });
});

describe('hashData', () => {
  it('is deterministic for identical input', () => {
    expect(hashData('api-key-value')).toBe(hashData('api-key-value'));
  });

  it('produces different hashes for different input', () => {
    expect(hashData('a')).not.toBe(hashData('b'));
  });
});

describe('generateApiKey', () => {
  it('prefixes the key with the given prefix', () => {
    expect(generateApiKey('pk_test')).toMatch(/^pk_test_[a-f0-9]{64}$/);
  });

  it('defaults to the "pk" prefix', () => {
    expect(generateApiKey()).toMatch(/^pk_[a-f0-9]{64}$/);
  });

  it('generates unique keys on each call', () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });
});
