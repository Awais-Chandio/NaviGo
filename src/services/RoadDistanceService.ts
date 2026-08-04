import { fetchWithTimeout, isCallerAbort } from '../utils/networkUtils';
import { getHaversineDistance, isValidCoordinate } from '../utils/locationUtils';

const ROAD_DISTANCE_TIMEOUT_MS = 5000;
const ROAD_DISTANCE_ENDPOINTS = [
  'https://router.project-osrm.org',
  'https://routing.openstreetmap.de/routed-car',
];

export interface RoadDistanceDestination {
  latitude: number;
  longitude: number;
}

export interface DrivingDistanceProvider {
  getDrivingDistances(
    origin: RoadDistanceDestination,
    destinations: RoadDistanceDestination[],
    signal?: AbortSignal,
  ): Promise<Array<number | null>>;
}

function isValidRoadCoordinate(location: RoadDistanceDestination): boolean {
  return (
    !!location &&
    isValidCoordinate(location.latitude, location.longitude, true)
  );
}

export class RoadDistanceService implements DrivingDistanceProvider {
  public async getDrivingDistances(
    origin: RoadDistanceDestination,
    destinations: RoadDistanceDestination[],
    signal?: AbortSignal,
  ): Promise<Array<number | null>> {
    if (!isValidRoadCoordinate(origin)) {
      throw new Error('A valid origin is required for road distances.');
    }
    if (destinations.length === 0) return [];

    const indexedDestinations = destinations
      .map((destination, originalIndex) => ({ destination, originalIndex }))
      .filter(entry => isValidRoadCoordinate(entry.destination));
    const output: Array<number | null> = destinations.map(() => null);
    if (indexedDestinations.length === 0) return output;

    const coordinates = [
      origin,
      ...indexedDestinations.map(entry => entry.destination),
    ]
      .map(location => `${location.longitude},${location.latitude}`)
      .join(';');
    const destinationIndexes = indexedDestinations
      .map((_, index) => index + 1)
      .join(';');
    let lastError: Error | null = null;

    for (const endpoint of ROAD_DISTANCE_ENDPOINTS) {
      try {
        const url =
          `${endpoint}/table/v1/driving/${coordinates}` +
          `?sources=0&destinations=${destinationIndexes}&annotations=distance`;
        const response = await fetchWithTimeout(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'NaviGo-NavigationApp/1.0 (contact@navigo.app)',
          },
          signal,
          timeoutMs: ROAD_DISTANCE_TIMEOUT_MS,
        });
        if (!response.ok) {
          throw new Error(
            `Road distance service unavailable (HTTP ${response.status}).`,
          );
        }

        const payload = (await response.json()) as {
          code?: string;
          distances?: Array<Array<number | null>>;
        };
        const distanceRow = payload.distances?.[0];
        if (
          payload.code !== 'Ok' ||
          !Array.isArray(distanceRow) ||
          distanceRow.length !== indexedDestinations.length
        ) {
          throw new Error(
            'Road distance service returned an invalid response.',
          );
        }

        indexedDestinations.forEach((entry, matrixIndex) => {
          const distance = distanceRow[matrixIndex];
          const directDistance = getHaversineDistance(
            origin.latitude,
            origin.longitude,
            entry.destination.latitude,
            entry.destination.longitude,
          );
          output[entry.originalIndex] =
            typeof distance === 'number' &&
            Number.isFinite(distance) &&
            distance >= 0 &&
            // Allow normal road snapping tolerance, but reject impossible
            // matrix values shorter than the geodesic separation.
            distance + 25 >= directDistance * 0.8
              ? Math.round(distance)
              : null;
        });
        return output;
      } catch (error) {
        if (isCallerAbort(error, signal)) throw error;
        lastError =
          error instanceof Error
            ? error
            : new Error('Road distance service unavailable.');
      }
    }

    throw lastError || new Error('All road distance services are unavailable.');
  }
}

export const roadDistanceService = new RoadDistanceService();
