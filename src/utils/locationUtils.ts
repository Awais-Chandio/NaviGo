/**
 * Utility functions for geolocation calculations, bearing, distance, polyline projection, and formatting.
 */

/**
 * Calculates the Haversine distance between two coordinates in meters.
 */
export function getHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371e3; // Earth radius in meters
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

/**
 * Calculates bearing (heading angle in degrees 0-360) from point 1 to point 2.
 */
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

/**
 * Calculates perpendicular distance in meters from point P (lat, lon) to line segment AB.
 */
export function getDistanceFromPointToLineSegment(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const abDist = getHaversineDistance(aLat, aLng, bLat, bLng);
  if (abDist === 0) {
    return getHaversineDistance(pLat, pLng, aLat, aLng);
  }

  // Projection factor t
  const t =
    ((pLat - aLat) * (bLat - aLat) + (pLng - aLng) * (bLng - aLng)) /
    (Math.pow(bLat - aLat, 2) + Math.pow(bLng - aLng, 2));

  const clampedT = Math.max(0, Math.min(1, t));
  const projLat = aLat + clampedT * (bLat - aLat);
  const projLng = aLng + clampedT * (bLng - aLng);

  return getHaversineDistance(pLat, pLng, projLat, projLng);
}

/**
 * Calculates minimum distance in meters from user location to a route polyline.
 */
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

/**
 * Estimates remaining distance (meters) along route from closest segment to end.
 */
export function calculateRemainingDistanceOnRoute(
  userLat: number,
  userLng: number,
  routeCoordinates: [number, number][],
): number {
  if (!routeCoordinates || routeCoordinates.length < 2) {
    return 0;
  }

  let minSegIndex = 0;
  let minSegDist = Infinity;

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
    if (dist < minSegDist) {
      minSegDist = dist;
      minSegIndex = i;
    }
  }

  // Distance from user to remaining points along route
  let remainingMeters = getHaversineDistance(
    userLat,
    userLng,
    routeCoordinates[minSegIndex + 1][1],
    routeCoordinates[minSegIndex + 1][0],
  );

  for (let j = minSegIndex + 1; j < routeCoordinates.length - 1; j++) {
    const [lng1, lat1] = routeCoordinates[j];
    const [lng2, lat2] = routeCoordinates[j + 1];
    remainingMeters += getHaversineDistance(lat1, lng1, lat2, lng2);
  }

  return Math.round(remainingMeters);
}

/**
 * Calculates bounding box in MapLibre LngLatBounds format: [west, south, east, north]
 */
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

/**
 * Formats distance in meters to readable format (e.g. 850 m or 4.5 km)
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = (meters / 1000).toFixed(1);
  return `${km} km`;
}

/**
 * Formats duration in seconds to readable format (e.g. 12 min or 1 h 25 min)
 */
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
