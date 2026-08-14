/**
 * Validate credit card number using Luhn algorithm
 */
export function validateCardNumber(cardNumber: string): boolean {
  const sanitized = cardNumber.replace(/\s+/g, '');

  if (!/^\d{13,19}$/.test(sanitized)) {
    return false;
  }

  let sum = 0;
  let isEven = false;

  for (let i = sanitized.length - 1; i >= 0; i--) {
    let digit = parseInt(sanitized[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Detect card type from card number
 */
export function detectCardType(cardNumber: string): string {
  const sanitized = cardNumber.replace(/\s+/g, '');

  if (/^4/.test(sanitized)) {
    return 'VISA';
  } else if (/^5[1-5]/.test(sanitized)) {
    return 'MASTERCARD';
  } else if (/^3[47]/.test(sanitized)) {
    return 'AMEX';
  } else if (/^6(?:011|5)/.test(sanitized)) {
    return 'DISCOVER';
  }

  return 'UNKNOWN';
}

/**
 * Validate expiry date
 */
export function validateExpiryDate(month: number, year: number): boolean {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (month < 1 || month > 12) {
    return false;
  }

  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return false;
  }

  return true;
}

/**
 * Validate CVV
 */
export function validateCvv(cvv: string, cardType: string): boolean {
  if (cardType === 'AMEX') {
    return /^\d{4}$/.test(cvv);
  }
  return /^\d{3}$/.test(cvv);
}
