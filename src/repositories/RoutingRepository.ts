import { RouteDetails, OSRMStep, parseOSRMSteps } from '../services/routingService';
import { formatDistance, formatDuration } from '../utils/locationUtils';
import { offlineRoutingService } from '../services/OfflineRoutingService';
import { logger } from '../utils/logger';

const TAG = 'RoutingRepository';
const OSRM_TIMEOUT_MS = 12000;

async function fetchRouteWithRetry(
  url: string,
  signal?: AbortSignal,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) {
      controller.abort();
    } else {
      signal?.addEventListener('abort', abortFromCaller, { once: true });
    }

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) return response;
      lastError = new Error(
        `Routing server unavailable (HTTP ${response.status})`,
      );
      if (response.status < 500 && response.status !== 429) {
        throw lastError;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortFromCaller);
    }

    if (attempt === 1) {
      logger.info(TAG, 'OSRM request failed; retrying once.');
      await new Promise<void>(resolve => setTimeout(resolve, 300));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Routing server unavailable.');
}

export class NoRouteFoundError extends Error {
  constructor(message = 'No driving route found to this destination.') {
    super(message);
    this.name = 'NoRouteFoundError';
  }
}

export class InvalidRoutingResponseError extends Error {
  constructor(message = 'The routing server returned an invalid route.') {
    super(message);
    this.name = 'InvalidRoutingResponseError';
  }
}

export interface IRoutingRepository {
  getRoute(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    signal?: AbortSignal,
  ): Promise<RouteDetails | null>;
  getRouteAlternatives(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    signal?: AbortSignal,
  ): Promise<RouteDetails[]>;
}

export class OSRMPlanRoutingRepository implements IRoutingRepository {
  async getRoute(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    signal?: AbortSignal,
  ): Promise<RouteDetails | null> {
    const alternatives = await this.getRouteAlternatives(
      startLat,
      startLng,
      endLat,
      endLng,
      signal,
    );
    return alternatives.length > 0 ? alternatives[0] : null;
  }

  async getRouteAlternatives(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    signal?: AbortSignal,
  ): Promise<RouteDetails[]> {
    try {
      const inputCoordinates = [startLat, startLng, endLat, endLng];
      if (
        !inputCoordinates.every(
          coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate),
        ) ||
        startLat < -90 ||
        startLat > 90 ||
        endLat < -90 ||
        endLat > 90 ||
        startLng < -180 ||
        startLng > 180 ||
        endLng < -180 ||
        endLng > 180
      ) {
        throw new InvalidRoutingResponseError('Invalid routing coordinates.');
      }

      // OSRM requires coordinates in longitude,latitude order
      const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true&alternatives=3&continue_straight=default`;

      const response = await fetchRouteWithRetry(url, signal);

      let rawPayload: unknown;
      try {
        rawPayload = await response.json();
      } catch {
        throw new InvalidRoutingResponseError(
          'The routing server returned malformed JSON.',
        );
      }
      if (!rawPayload || typeof rawPayload !== 'object') {
        throw new InvalidRoutingResponseError();
      }

      const data = rawPayload as {
        code?: string;
        message?: string;
        routes?: Array<{
          geometry?: { coordinates?: [number, number][] };
          distance?: number;
          duration?: number;
          legs?: Array<{ steps?: OSRMStep[] }>;
        }>;
      };

      if (data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
        if (data.code === 'NoRoute') {
          throw new NoRouteFoundError(data.message);
        }
        logger.warn(TAG, 'OSRM returned an invalid route payload.', data.code);
        throw new InvalidRoutingResponseError(data.message);
      }

      // Filter and validate every route payload strictly
      const validRawRoutes = data.routes.filter(rt => {
        if (!rt || !rt.geometry || !Array.isArray(rt.geometry.coordinates)) return false;
        const coords = rt.geometry.coordinates;
        if (coords.length < 2) return false;
        const isValidCoords = coords.every(
          pt =>
            Array.isArray(pt) &&
            pt.length === 2 &&
            typeof pt[0] === 'number' &&
            Number.isFinite(pt[0]) &&
            pt[0] >= -180 &&
            pt[0] <= 180 &&
            typeof pt[1] === 'number' &&
            Number.isFinite(pt[1]) &&
            pt[1] >= -90 &&
            pt[1] <= 90,
        );
        const isValidDistance =
          typeof rt.distance === 'number' &&
          Number.isFinite(rt.distance) &&
          rt.distance > 0;
        const isValidDuration =
          typeof rt.duration === 'number' &&
          Number.isFinite(rt.duration) &&
          rt.duration > 0;
        const hasValidLegs =
          typeof rt.legs === 'undefined' || Array.isArray(rt.legs);
        return (
          isValidCoords &&
          isValidDistance &&
          isValidDuration &&
          hasValidLegs
        );
      });

      if (validRawRoutes.length === 0) {
        logger.warn(TAG, 'No OSRM route passed response validation.');
        throw new InvalidRoutingResponseError();
      }

      // Sort routes by duration ascending so index 0 is strictly the fastest driving route
      validRawRoutes.sort((a, b) => {
        const durA = a.duration || Infinity;
        const durB = b.duration || Infinity;
        if (durA !== durB) return durA - durB;
        return (a.distance || Infinity) - (b.distance || Infinity);
      });

      const shortestDistance = validRawRoutes.reduce(
        (minimum, route) => Math.min(minimum, route.distance || Infinity),
        Infinity,
      );
      const requestTimestamp = Date.now();
      const routeResults: RouteDetails[] = validRawRoutes.map((rt, index: number) => {
        // GeoJSON is already decoded and uses [longitude, latitude] ordering.
        const coordinates: [number, number][] = (
          rt.geometry?.coordinates || []
        ).map(point => [point[0], point[1]]);
        const distanceMeters: number = Math.round(rt.distance as number);
        const durationSeconds: number = Math.round(rt.duration as number);
        const rawSteps: OSRMStep[] = (rt.legs || []).reduce<OSRMStep[]>(
          (allSteps, leg) => allSteps.concat(leg.steps || []),
          [],
        );
        const steps = parseOSRMSteps(rawSteps);

        let tag: 'Fastest' | 'Shortest' | 'Alternative' = 'Alternative';
        if (index === 0) {
          tag = 'Fastest';
        } else if ((rt.distance as number) === shortestDistance) {
          tag = 'Shortest';
        }

        return {
          id: `route_${index}_${requestTimestamp}`,
          name: `Route ${index + 1} (${tag})`,
          tag,
          coordinates,
          distanceMeters,
          durationSeconds,
          formattedDistance: formatDistance(distanceMeters),
          formattedDuration: formatDuration(durationSeconds),
          steps,
        };
      });

      return routeResults;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        (error as { name: string }).name === 'AbortError'
      ) {
        return [];
      }
      logger.warn(TAG, 'Online route request failed.', error);
      throw error;
    }
  }
}

export class OfflineGraphRoutingRepository implements IRoutingRepository {
  async getRoute(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
  ): Promise<RouteDetails | null> {
    return offlineRoutingService.calculateOfflineRoute(
      startLat,
      startLng,
      endLat,
      endLng,
    );
  }

  async getRouteAlternatives(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
  ): Promise<RouteDetails[]> {
    const mainRoute = await offlineRoutingService.calculateOfflineRoute(
      startLat,
      startLng,
      endLat,
      endLng,
    );
    return mainRoute ? [mainRoute] : [];
  }
}
