import {
  getHaversineDistance,
  calculateBearing,
  formatDistance,
  formatDuration,
  calculateBoundingBox,
  calculateRouteProgress,
  calculateDynamicETA,
  getClosestPointOnSegment,
  isGPSJump,
  isValidCoordinate,
} from '../../src/utils/locationUtils';

describe('locationUtils', () => {
  test('validates coordinate ranges and rejects missing GPS sentinel values', () => {
    expect(isValidCoordinate(25.396, 68.3578, true)).toBe(true);
    expect(isValidCoordinate(91, 68, true)).toBe(false);
    expect(isValidCoordinate(25, 181, true)).toBe(false);
    expect(isValidCoordinate(0, 0, true)).toBe(false);
    expect(getHaversineDistance(91, 68, 25, 68)).toBe(Infinity);
  });

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
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.0 km');
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

  test('calculateRouteProgress calculates progress %, distance traveled, and remaining distance', () => {
    const coords: [number, number][] = [
      [68.3578, 25.396],
      [68.359, 25.397],
      [68.361, 25.399],
    ];
    const res = calculateRouteProgress(25.396, 68.3578, coords);
    expect(res.progressPct).toBe(0);
    expect(res.distanceTraveled).toBe(0);
    expect(res.remainingDistance).toBeGreaterThan(0);
  });

  test('calculateRouteProgress scales progress to the selected route distance', () => {
    const coords: [number, number][] = [
      [68.0, 25.0],
      [68.0, 25.01],
    ];
    const halfway = calculateRouteProgress(25.005, 68.0, coords, {
      routeDistanceMeters: 2000,
    });

    expect(halfway.distanceTraveled).toBeCloseTo(1000, -1);
    expect(halfway.remainingDistance).toBeCloseTo(1000, -1);
    expect(halfway.progressPct).toBeCloseTo(50, 0);
  });

  test('calculateRouteProgress cannot regress or make an implausible jump', () => {
    const coords: [number, number][] = [
      [68.0, 25.0],
      [68.0, 25.01],
    ];
    const constrained = calculateRouteProgress(25.009, 68.0, coords, {
      routeDistanceMeters: 1000,
      minimumDistanceTraveled: 300,
      maximumDistanceTraveled: 350,
    });
    expect(constrained.distanceTraveled).toBe(350);

    const nonRegressing = calculateRouteProgress(25.001, 68.0, coords, {
      routeDistanceMeters: 1000,
      minimumDistanceTraveled: 300,
    });
    expect(nonRegressing.distanceTraveled).toBe(300);
  });

  test('getClosestPointOnSegment returns an on-segment fraction', () => {
    const projection = getClosestPointOnSegment(
      25.005,
      68.001,
      25.0,
      68.0,
      25.01,
      68.0,
    );
    expect(projection.fraction).toBeCloseTo(0.5, 1);
    expect(projection.latitude).toBeCloseTo(25.005, 4);
  });

  test('calculateDynamicETA blends GPS speed and initial route speed', () => {
    const etaRes = calculateDynamicETA(1000, 40, 5000, 600); // 40 km/h GPS speed
    expect(etaRes.remainingDurationSeconds).toBeGreaterThan(0);
    expect(etaRes.etaString).toBeDefined();
  });

  test('calculateDynamicETA falls back to selected route speed without GPS speed', () => {
    const etaRes = calculateDynamicETA(2500, null, 5000, 600);
    expect(etaRes.remainingDurationSeconds).toBe(300);
    expect(etaRes.effectiveSpeedKmH).toBe(30);
  });

  test('calculateDynamicETA respects walking and bike live-speed ranges', () => {
    const walking = calculateDynamicETA(1000, 80, 1000, 720, 'walking');
    const motorbike = calculateDynamicETA(
      1000,
      50,
      1000,
      Math.round(1000 / (27 / 3.6)),
      'motorbike',
    );

    // A vehicle-like GPS speed must not corrupt a walking ETA.
    expect(walking.remainingDurationSeconds).toBe(720);
    expect(walking.effectiveSpeedKmH).toBe(5);
    // A fast sample may shorten ETA, but must not dominate the whole trip.
    expect(motorbike.effectiveSpeedKmH).toBeGreaterThan(27);
    expect(motorbike.effectiveSpeedKmH).toBeLessThanOrEqual(36.5);
    expect(motorbike.remainingDurationSeconds).toBeGreaterThan(95);
  });

  test('calculateDynamicETA increases car ETA when sustained GPS speed is slow', () => {
    const congested = calculateDynamicETA(
      5000,
      8,
      5000,
      900,
      'driving',
    );

    expect(congested.remainingDurationSeconds).toBeGreaterThan(900);
    expect(congested.effectiveSpeedKmH).toBeLessThan(20);
  });

  test('isGPSJump detects sudden impossible location jumps', () => {
    const now = Date.now();
    const isJump = isGPSJump(25.396, 68.3578, now, 25.5, 68.5, now + 500); // ~15km in 0.5s
    expect(isJump).toBe(true);
  });
});
