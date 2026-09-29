import { describe, expect, it } from 'vitest';
import { stripForwardedPorts } from './forwarded-for.js';

describe('stripForwardedPorts', () => {
  it('drops ports from IPv4 and bracketed IPv6 entries, leaves plain addresses alone', () => {
    expect(stripForwardedPorts('203.0.113.7:54321')).toBe('203.0.113.7');
    expect(stripForwardedPorts('203.0.113.7:1, 10.0.0.4:443')).toBe('203.0.113.7, 10.0.0.4');
    expect(stripForwardedPorts('[2001:db8::1]:8080, 198.51.100.2')).toBe('2001:db8::1, 198.51.100.2');
    expect(stripForwardedPorts('2001:db8::1')).toBe('2001:db8::1');
  });
});
