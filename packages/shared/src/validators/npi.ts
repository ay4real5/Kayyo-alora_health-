/**
 * National Provider Identifier: 10 digits whose last digit is a Luhn check digit computed over the prefix
 * "80840" + the first 9 digits (CMS NPI standard). Catches typos before a claim is rejected.
 */
export function isValidNpi(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = `80840${npi.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    // Double every second digit starting from the rightmost digit of the payload.
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(npi[9]);
}
