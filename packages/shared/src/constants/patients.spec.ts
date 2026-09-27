import { normalizeIcd10 } from './patients.js';

describe('normalizeIcd10', () => {
  it.each([
    ['E11.9', 'E11.9'],
    ['e119', 'E11.9'],
    [' i10 ', 'I10'],
    ['S72.001A', 'S72.001A'],
    ['Z79.4', 'Z79.4'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeIcd10(input)).toBe(expected);
  });

  it.each(['', '11.9', 'E1', 'E11.99999', 'E11..9', 'hello'])('rejects %s', (input) => {
    expect(normalizeIcd10(input)).toBeUndefined();
  });
});
