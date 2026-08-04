import { TRAVEL_MODE_CONFIG, type TravelMode } from '../config/travelModes';

export function getHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const rad = Math.PI / 180;
  const dLon = (lon2 - lon1) * rad;
  const y = Math.sin(dLon) * Math.cos(lat2 * rad);
  const x =
    Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
    Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * (180 / Math.PI);
  return (brng + 360) % 360;
}

export function getClosestPointOnSegment(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): {
  latitude: number;
  longitude: number;
  distanceMeters: number;
  fraction: number;
} {
  const abDist = getHaversineDistance(aLat, aLng, bLat, bLng);
  if (abDist === 0) {
    return {
      latitude: aLat,
      longitude: aLng,
      distanceMeters: getHaversineDistance(pLat, pLng, aLat, aLng),
      fraction: 0,
    };
  }

  // Project in a local equirectangular plane. Performing this calculation
  // directly in latitude/longitude degrees over-weights longitude and causes
  // visible snapping/progress errors away from the equator.
  const rad = Math.PI / 180;
  const meanLat = ((aLat + bLat + pLat) / 3) * rad;
  const longitudeScale = Math.max(0.01, Math.cos(meanLat));
  const abX = (bLng - aLng) * longitudeScale;
  const abY = bLat - aLat;
  const apX = (pLng - aLng) * longitudeScale;
  const apY = pLat - aLat;
  const denominator = abX * abX + abY * abY;
  const t = denominator === 0 ? 0 : (apX * abX + apY * abY) / denominator;
  const clampedT = Math.max(0, Math.min(1, t));

  const projLat = aLat + clampedT * (bLat - aLat);
  const projLng = aLng + clampedT * (bLng - aLng);
  const distanceMeters = getHaversineDistance(pLat, pLng, projLat, projLng);

  return {
    latitude: projLat,
    longitude: projLng,
    distanceMeters,
    fraction: clampedT,
  };
}

export function calculateSpeed(
  distanceMeters: number,
  timeSeconds: number,
): number {
  if (timeSeconds <= 0) return 0;
  const metersPerSec = distanceMeters / timeSeconds;
  return Math.round(metersPerSec * 3.6); // km/h
}

export function smoothBearing(
  currentBearing: number,
  targetBearing: number,
  alpha = 0.25,
): number {
  let diff = targetBearing - currentBearing;
  while (diff < -180) diff += 360;
  while (diff > 180) diff -= 360;
  const smoothed = currentBearing + alpha * diff;
  return (smoothed + 360) % 360;
}

export function getDistanceFromPointToLineSegment(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  return getClosestPointOnSegment(pLat, pLng, aLat, aLng, bLat, bLng)
    .distanceMeters;
}

export function getDistanceToRoute(
  userLat: number,
  userLng: number,
  routeCoordinates: [number, number][],
): number {
  if (!routeCoordinates || routeCoordinates.length < 2) {
    return 0;
  }

  let minDistance = Infinity;

  for (let i = 0; i < routeCoordinates.length - 1; i++) {
    const [aLng, aLat] = routeCoordinates[i];
    const [bLng, bLat] = routeCoordinates[i + 1];
    const dist = getDistanceFromPointToLineSegment(
      userLat,
      userLng,
      aLat,
      aLng,
      bLat,
      bLng,
    );
    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return minDistance === Infinity ? 0 : minDistance;
}

export function calculateRemainingDistanceOnRoute(
  userLat: number,
  userLng: number,
  routeCoordinates: [number, number][],
): number {
  if (!routeCoordinates || routeCoordinates.length < 2) {
    return 0;
  }

  const metrics = buildRouteGeometryMetrics(routeCoordinates);
  const projection = findClosestPointOnRoute(
    userLat,
    userLng,
    routeCoordinates,
    metrics,
  );
  return Math.round(
    Math.max(0, metrics.totalDistance - projection.distanceAlongRoute),
  );
}

export function calculateBoundingBox(
  coordinates: [number, number][],
): [number, number, number, number] {
  if (!coordinates || coordinates.length === 0) {
    return [0, 0, 0, 0];
  }

  let minLng = coordinates[0][0];
  let maxLng = coordinates[0][0];
  let minLat = coordinates[0][1];
  let maxLat = coordinates[0][1];

  for (let i = 1; i < coordinates.length; i++) {
    const [lng, lat] = coordinates[i];
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return [minLng, minLat, maxLng, maxLat];
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = (meters / 1000).toFixed(1);
  return `${km} km`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${remainingMins} min`;
}

export function formatETA(etaDate: Date): string {
  let hours = etaDate.getHours();
  const minutes = etaDate.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minsStr = minutes < 10 ? `0${minutes}` : minutes;
  return `${hours}:${minsStr} ${ampm}`;
}

export interface RouteProgressResult {
  distanceTraveled: number;
  remainingDistance: number;
  progressPct: number;
  nearestSegmentIndex: number;
  distanceToRoute: number;
  snappedLatitude: number;
  snappedLongitude: number;
  geometryDistanceTraveled: number;
}

export interface RouteGeometryMetrics {
  segmentDistances: number[];
  cumulativeDistances: number[];
  totalDistance: number;
}

export interface RouteProjectionResult {
  latitude: number;
  longitude: number;
  distanceMeters: number;
  segmentIndex: number;
  segmentFraction: number;
  distanceAlongRoute: number;
}

export interface RouteProgressOptions {
  lastSegmentIndex?: number;
  routeDistanceMeters?: number;
  minimumDistanceTraveled?: number;
  maximumDistanceTraveled?: number;
  metrics?: RouteGeometryMetrics;
  searchBehindSegments?: number;
  searchAheadSegments?: number;
}

export function buildRouteGeometryMetrics(
  routeCoordinates: [number, number][],
): RouteGeometryMetrics {
  const segmentDistances: number[] = [];
  const cumulativeDistances: number[] = [0];
  let totalDistance = 0;

  if (!Array.isArray(routeCoordinates)) {
    return { segmentDistances, cumulativeDistances, totalDistance };
  }

  for (let index = 0; index < routeCoordinates.length - 1; index++) {
    const [startLng, startLat] = routeCoordinates[index];
    const [endLng, endLat] = routeCoordinates[index + 1];
    const distance = getHaversineDistance(startLat, startLng, endLat, endLng);
    const safeDistance = Number.isFinite(distance) ? distance : 0;
    segmentDistances.push(safeDistance);
    totalDistance += safeDistance;
    cumulativeDistances.push(totalDistance);
  }

  return { segmentDistances, cumulativeDistances, totalDistance };
}

export function findClosestPointOnRoute(
  userLat: number,
  userLng: number,
  routeCoordinates: [number, number][],
  metrics = buildRouteGeometryMetrics(routeCoordinates),
  startSegmentIndex = 0,
  endSegmentIndex = routeCoordinates.length - 2,
): RouteProjectionResult {
  if (!routeCoordinates || routeCoordinates.length < 2) {
    return {
      latitude: userLat,
      longitude: userLng,
      distanceMeters: Infinity,
      segmentIndex: 0,
      segmentFraction: 0,
      distanceAlongRoute: 0,
    };
  }

  const finalSegmentIndex = routeCoordinates.length - 2;
  const startIndex = Math.max(
    0,
    Math.min(finalSegmentIndex, startSegmentIndex),
  );
  const endIndex = Math.max(
    startIndex,
    Math.min(finalSegmentIndex, endSegmentIndex),
  );

  let best: RouteProjectionResult = {
    latitude: userLat,
    longitude: userLng,
    distanceMeters: Infinity,
    segmentIndex: startIndex,
    segmentFraction: 0,
    distanceAlongRoute: metrics.cumulativeDistances[startIndex] || 0,
  };

  for (let index = startIndex; index <= endIndex; index++) {
    const [startLng, startLat] = routeCoordinates[index];
    const [endLng, endLat] = routeCoordinates[index + 1];
    const projection = getClosestPointOnSegment(
      userLat,
      userLng,
      startLat,
      startLng,
      endLat,
      endLng,
    );

    if (projection.distanceMeters < best.distanceMeters) {
      best = {
        latitude: projection.latitude,
        longitude: projection.longitude,
        distanceMeters: projection.distanceMeters,
        segmentIndex: index,
        segmentFraction: projection.fraction,
        distanceAlongRoute:
          (metrics.cumulativeDistances[index] || 0) +
          (metrics.segmentDistances[index] || 0) * projection.fraction,
      };
    }
  }

  return best;
}

export function getPointAtRouteDistance(
  routeCoordinates: [number, number][],
  distanceAlongRoute: number,
  metrics = buildRouteGeometryMetrics(routeCoordinates),
): {
  latitude: number;
  longitude: number;
  segmentIndex: number;
  segmentFraction: number;
} {
  if (!routeCoordinates || routeCoordinates.length === 0) {
    return { latitude: 0, longitude: 0, segmentIndex: 0, segmentFraction: 0 };
  }

  if (routeCoordinates.length === 1 || metrics.totalDistance <= 0) {
    return {
      latitude: routeCoordinates[0][1],
      longitude: routeCoordinates[0][0],
      segmentIndex: 0,
      segmentFraction: 0,
    };
  }

  const clampedDistance = Math.max(
    0,
    Math.min(metrics.totalDistance, distanceAlongRoute),
  );
  let segmentIndex = metrics.segmentDistances.length - 1;

  for (let index = 0; index < metrics.segmentDistances.length; index++) {
    if (clampedDistance <= metrics.cumulativeDistances[index + 1]) {
      segmentIndex = index;
      break;
    }
  }

  const segmentStartDistance = metrics.cumulativeDistances[segmentIndex] || 0;
  const segmentDistance = metrics.segmentDistances[segmentIndex] || 0;
  const fraction =
    segmentDistance > 0
      ? Math.max(
          0,
          Math.min(
            1,
            (clampedDistance - segmentStartDistance) / segmentDistance,
          ),
        )
      : 0;
  const [startLng, startLat] = routeCoordinates[segmentIndex];
  const [endLng, endLat] = routeCoordinates[segmentIndex + 1];

  return {
    latitude: startLat + (endLat - startLat) * fraction,
    longitude: startLng + (endLng - startLng) * fraction,
    segmentIndex,
    segmentFraction: fraction,
  };
}

export function calculateRouteProgress(
  userLat: number,
  userLng: number,
  routeCoordinates: [number, number][],
  lastSegmentIndexOrOptions?: number | RouteProgressOptions,
): RouteProgressResult {
  if (!routeCoordinates || routeCoordinates.length < 2) {
    return {
      distanceTraveled: 0,
      remainingDistance: 0,
      progressPct: 0,
      nearestSegmentIndex: 0,
      distanceToRoute: 0,
      snappedLatitude: userLat,
      snappedLongitude: userLng,
      geometryDistanceTraveled: 0,
    };
  }

  const options: RouteProgressOptions =
    typeof lastSegmentIndexOrOptions === 'number'
      ? { lastSegmentIndex: lastSegmentIndexOrOptions }
      : lastSegmentIndexOrOptions || {};
  const metrics =
    options.metrics || buildRouteGeometryMetrics(routeCoordinates);
  const geometryDistance = metrics.totalDistance;
  const routeDistance =
    typeof options.routeDistanceMeters === 'number' &&
    Number.isFinite(options.routeDistanceMeters) &&
    options.routeDistanceMeters > 0
      ? options.routeDistanceMeters
      : geometryDistance;

  if (geometryDistance <= 0 || routeDistance <= 0) {
    return {
      distanceTraveled: 0,
      remainingDistance: 0,
      progressPct: 100,
      nearestSegmentIndex: 0,
      distanceToRoute: 0,
      snappedLatitude: routeCoordinates[0][1],
      snappedLongitude: routeCoordinates[0][0],
      geometryDistanceTraveled: 0,
    };
  }

  let startIdx = 0;
  let endIdx = routeCoordinates.length - 2;

  if (
    typeof options.lastSegmentIndex === 'number' &&
    options.lastSegmentIndex >= 0
  ) {
    startIdx = Math.max(
      0,
      options.lastSegmentIndex - (options.searchBehindSegments ?? 1),
    );
    endIdx = Math.min(
      routeCoordinates.length - 2,
      options.lastSegmentIndex + (options.searchAheadSegments ?? 25),
    );
  }

  const projection = findClosestPointOnRoute(
    userLat,
    userLng,
    routeCoordinates,
    metrics,
    startIdx,
    endIdx,
  );
  const routeScale = routeDistance / geometryDistance;
  const rawDistanceTraveled = projection.distanceAlongRoute * routeScale;
  const minimumDistance = Math.max(0, options.minimumDistanceTraveled ?? 0);
  const maximumDistance = Math.min(
    routeDistance,
    Math.max(minimumDistance, options.maximumDistanceTraveled ?? routeDistance),
  );
  const distanceTraveled = Math.max(
    minimumDistance,
    Math.min(maximumDistance, rawDistanceTraveled),
  );
  const wasAdvanceClamped = rawDistanceTraveled > maximumDistance;
  const remainingDistance = Math.max(
    0,
    Math.round(routeDistance - distanceTraveled),
  );
  const progressPct = Math.min(
    100,
    Math.max(0, Number(((distanceTraveled / routeDistance) * 100).toFixed(1))),
  );

  return {
    distanceTraveled: Math.round(distanceTraveled),
    remainingDistance,
    progressPct,
    nearestSegmentIndex:
      wasAdvanceClamped && typeof options.lastSegmentIndex === 'number'
        ? options.lastSegmentIndex
        : projection.segmentIndex,
    distanceToRoute: projection.distanceMeters,
    snappedLatitude: projection.latitude,
    snappedLongitude: projection.longitude,
    geometryDistanceTraveled: projection.distanceAlongRoute,
  };
}

export interface DynamicETAResult {
  remainingDurationSeconds: number;
  etaString: string;
  effectiveSpeedKmH: number;
}

export function calculateDynamicETA(
  remainingDistanceMeters: number,
  currentSpeedKmH: number | null | undefined,
  initialRouteDistanceMeters: number,
  initialRouteDurationSeconds: number,
  travelMode: TravelMode = 'driving',
): DynamicETAResult {
  const modeConfig = TRAVEL_MODE_CONFIG[travelMode];
  const safeRemainingDistance = Math.max(0, remainingDistanceMeters);
  const baselineSpeedMetersPerSec =
    initialRouteDistanceMeters > 0 && initialRouteDurationSeconds > 0
      ? initialRouteDistanceMeters / initialRouteDurationSeconds
      : modeConfig.baselineSpeedKmH / 3.6;
  const hasUsableGpsSpeed =
    typeof currentSpeedKmH === 'number' &&
    Number.isFinite(currentSpeedKmH) &&
    currentSpeedKmH >= modeConfig.minimumGpsSpeedKmH &&
    currentSpeedKmH <= modeConfig.maximumGpsSpeedKmH;

  let effectiveSpeedMetersPerSec = baselineSpeedMetersPerSec;
  if (hasUsableGpsSpeed) {
    const gpsSpeedMetersPerSec = currentSpeedKmH / 3.6;
    // Route speed remains the stronger signal because it represents the road
    // classes ahead; live speed corrects it for current conditions.
    const blendedSpeed =
      0.4 * gpsSpeedMetersPerSec + 0.6 * baselineSpeedMetersPerSec;
    effectiveSpeedMetersPerSec = Math.max(
      baselineSpeedMetersPerSec * 0.35,
      Math.min(baselineSpeedMetersPerSec * 2, blendedSpeed),
    );
  }

  effectiveSpeedMetersPerSec = Math.max(0.5, effectiveSpeedMetersPerSec);

  const remainingDurationSeconds = Math.round(
    safeRemainingDistance / effectiveSpeedMetersPerSec,
  );
  const etaDate = new Date(Date.now() + remainingDurationSeconds * 1000);
  const etaString = formatETA(etaDate);

  return {
    remainingDurationSeconds,
    etaString,
    effectiveSpeedKmH: Number((effectiveSpeedMetersPerSec * 3.6).toFixed(1)),
  };
}

export function isGPSJump(
  lastLat: number,
  lastLng: number,
  lastTimestampMs: number,
  newLat: number,
  newLng: number,
  newTimestampMs: number,
  maximumPlausibleSpeedMps = 60,
): boolean {
  if (lastTimestampMs <= 0 || newTimestampMs <= lastTimestampMs) return false;
  const timeDeltaSec = (newTimestampMs - lastTimestampMs) / 1000;
  const distanceMeters = getHaversineDistance(lastLat, lastLng, newLat, newLng);

  // Reject discontinuities that cannot represent normal road movement.
  if (timeDeltaSec < 1.0 && distanceMeters > 100) return true;
  const impliedSpeedMps = distanceMeters / timeDeltaSec;
  return impliedSpeedMps > maximumPlausibleSpeedMps;
}
