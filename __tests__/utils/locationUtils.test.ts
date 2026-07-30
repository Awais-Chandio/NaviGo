import {
  getHaversineDistance,
  calculateBearing,
  formatDistance,
  formatDuration,
  calculateBoundingBox,
} from '../../src/utils/locationUtils';

describe('locationUtils', () => {
  test('getHaversineDistance calculates distance correctly', () => {
    // Distance between Karachi (24.8607, 67.0011) and Hyderabad (25.396, 68.3578) is approx ~148 km
    const dist = getHaversineDistance(24.8607, 67.0011, 25.396, 68.3578);
    expect(dist).toBeGreaterThan(130000);
    expect(dist).toBeLessThan(160000);
  });

  test('calculateBearing calculates heading correctly', () => {
    const bearing = calculateBearing(0, 0, 1, 0); // Due North
    expect(Math.round(bearing)).toBe(0);
  });

  test('formatDistance formats meters and kilometers', () => {
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(2500)).toBe('2.5 km');
  });

  test('formatDuration formats minutes and hours', () => {
    expect(formatDuration(180)).toBe('3 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(5400)).toBe('1 h 30 min');
  });

  test('calculateBoundingBox returns bounding box', () => {
    const coords: [number, number][] = [
      [67.0, 24.8],
      [68.3, 25.4],
    ];
    const bbox = calculateBoundingBox(coords);
    expect(bbox).toEqual([67.0, 24.8, 68.3, 25.4]);
  });
});
