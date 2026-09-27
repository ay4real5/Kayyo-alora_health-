import { isValidNpi } from './npi.js';

describe('isValidNpi', () => {
  it('accepts NPIs with a correct check digit', () => {
    expect(isValidNpi('1234567893')).toBe(true); // CMS example
    expect(isValidNpi('1245319599')).toBe(true);
  });

  it('rejects a wrong check digit, wrong length or non-digits', () => {
    expect(isValidNpi('1234567890')).toBe(false);
    expect(isValidNpi('123456789')).toBe(false);
    expect(isValidNpi('12345678931')).toBe(false);
    expect(isValidNpi('12345678a3')).toBe(false);
  });
});
