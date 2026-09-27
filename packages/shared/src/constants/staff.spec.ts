import { credentialState } from './staff.js';

describe('credentialState', () => {
  const today = '2026-09-27';
  it.each([
    [null, 30, 'no_expiry'],
    ['2026-09-26', 30, 'expired'],
    ['2026-09-27', 30, 'expiring_soon'], // expires today: still valid today, but alert
    ['2026-10-27', 30, 'expiring_soon'], // exactly 30 days out
    ['2026-10-28', 30, 'valid'],
    ['2026-10-05', 7, 'valid'],
  ] as const)('expiry %s with %i-day alert → %s', (expiry, days, state) => {
    expect(credentialState(expiry, days, today)).toBe(state);
  });
});
