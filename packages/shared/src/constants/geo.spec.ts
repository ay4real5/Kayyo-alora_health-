import { distanceMeters, isValidCoordinate } from './geo.js';

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters({ lat: 39.78, lng: -89.65 }, { lat: 39.78, lng: -89.65 })).toBe(0);
  });

  it('matches known distances', () => {
    // 0.001° of latitude ≈ 111.2 m anywhere.
    expect(distanceMeters({ lat: 39.78, lng: -89.65 }, { lat: 39.781, lng: -89.65 })).toBeCloseTo(111.2, 0);
    // New York City Hall → Los Angeles City Hall ≈ 3,936 km.
    const d = distanceMeters({ lat: 40.7128, lng: -74.006 }, { lat: 34.0537, lng: -118.2428 });
    expect(d / 1000).toBeGreaterThan(3930);
    expect(d / 1000).toBeLessThan(3945);
  });

  it('validates coordinates', () => {
    expect(isValidCoordinate(39.78, -89.65)).toBe(true);
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 0)).toBe(false);
  });
});
