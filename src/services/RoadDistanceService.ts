import { fetchWithTimeout } from '../utils/networkUtils';

const ROAD_DISTANCE_TIMEOUT_MS = 7000;

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

function isValidCoordinate(location: RoadDistanceDestination): boolean {
  return (
    Number.isFinite(location.latitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    Number.isFinite(location.longitude) &&
    location.longitude >= -180 &&
    location.longitude <= 180
  );
}

export class RoadDistanceService implements DrivingDistanceProvider {
  public async getDrivingDistances(
    origin: RoadDistanceDestination,
    destinations: RoadDistanceDestination[],
    signal?: AbortSignal,
  ): Promise<Array<number | null>> {
    if (!isValidCoordinate(origin)) {
      throw new Error('A valid origin is required for road distances.');
    }
    if (destinations.length === 0) return [];

    const indexedDestinations = destinations
      .map((destination, originalIndex) => ({ destination, originalIndex }))
      .filter(entry => isValidCoordinate(entry.destination));
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
    const url =
      `https://router.project-osrm.org/table/v1/driving/${coordinates}` +
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
      throw new Error('Road distance service returned an invalid response.');
    }

    indexedDestinations.forEach((entry, matrixIndex) => {
      const distance = distanceRow[matrixIndex];
      output[entry.originalIndex] =
        typeof distance === 'number' &&
        Number.isFinite(distance) &&
        distance >= 0
          ? Math.round(distance)
          : null;
    });
    return output;
  }
}

export const roadDistanceService = new RoadDistanceService();
