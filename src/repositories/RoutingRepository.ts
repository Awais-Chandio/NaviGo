import { RouteDetails, OSRMStep, parseOSRMSteps } from '../services/routingService';
import {
  formatDistance,
  formatDuration,
  getHaversineDistance,
  isValidCoordinate,
} from '../utils/locationUtils';
import { offlineRoutingService } from '../services/OfflineRoutingService';
import { logger } from '../utils/logger';
import {
  fetchWithTimeout,
  isCallerAbort,
  RequestTimeoutError,
  waitForRetry,
} from '../utils/networkUtils';

const TAG = 'RoutingRepository';
const OSRM_TIMEOUT_MS = 7000;
const OSRM_ROUTE_ENDPOINTS = [
  'https://router.project-osrm.org',
  'https://routing.openstreetmap.de/routed-car',
];

class NonRetryableRoutingHttpError extends Error {}

async function fetchRouteWithRetry(
  url: string,
  signal?: AbortSignal,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NaviGo-NavigationApp/1.0 (contact@navigo.app)',
        },
        signal,
        timeoutMs: OSRM_TIMEOUT_MS,
      });
      if (response.ok) return response;
      const httpError = new Error(
        `Routing server unavailable (HTTP ${response.status})`,
      );
      lastError = httpError;
      if (response.status < 500 && response.status !== 429) {
        throw new NonRetryableRoutingHttpError(httpError.message);
      }
    } catch (error) {
      if (
        isCallerAbort(error, signal) ||
        error instanceof NonRetryableRoutingHttpError
      ) {
        throw error;
      }
      lastError = error;
      // A second full timeout doubles the wait after a location tap. Retry
      // quick transient failures, but fail fast when the server timed out.
      if (error instanceof RequestTimeoutError) {
        break;
      }
    }

    if (attempt === 1) {
      logger.info(TAG, 'OSRM request failed; retrying once.');
      await waitForRetry(300, signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Routing server unavailable.');
}

async function fetchFastestRouteResponse(
  routePath: string,
  signal?: AbortSignal,
): Promise<Response> {
  type RouteOutcome = { response?: Response; error?: unknown; index: number };
  const controllers = OSRM_ROUTE_ENDPOINTS.map(() => new AbortController());
  const abortRequests = () => controllers.forEach(controller => controller.abort());
  if (signal?.aborted) {
    abortRequests();
  } else {
    signal?.addEventListener('abort', abortRequests, { once: true });
  }

  const requests = OSRM_ROUTE_ENDPOINTS.map((endpoint, index) =>
    fetchRouteWithRetry(`${endpoint}${routePath}`, controllers[index].signal)
      .then(response => ({ response, index } as RouteOutcome))
      .catch(error => ({ error, index } as RouteOutcome)),
  );

  try {
    const first = await Promise.race(requests);
    if (signal?.aborted) {
      throw first.error || new Error('Route request was cancelled.');
    }
    if (first.response) {
      controllers.forEach((controller, index) => {
        if (index !== first.index) controller.abort();
      });
      return first.response;
    }

    const second = await requests[first.index === 0 ? 1 : 0];
    if (signal?.aborted) {
      throw second.error || first.error || new Error('Route request was cancelled.');
    }
    if (second.response) return second.response;
    throw second.error || first.error || new Error('Routing servers unavailable.');
  } finally {
    signal?.removeEventListener('abort', abortRequests);
  }
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
    const startedAt = Date.now();
    try {
      if (
        !isValidCoordinate(startLat, startLng, true) ||
        !isValidCoordinate(endLat, endLng, true)
      ) {
        throw new InvalidRoutingResponseError('Invalid routing coordinates.');
      }

      // OSRM requires coordinates in longitude,latitude order. Race two
      // compatible public endpoints so one overloaded server cannot hold the
      // location-opening flow for the full timeout.
      const routePath = `/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true&alternatives=3&continue_straight=default`;
      const response = await fetchFastestRouteResponse(routePath, signal);

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
        if (
          !isValidCoords ||
          !isValidDistance ||
          !isValidDuration ||
          !hasValidLegs
        ) {
          return false;
        }

        const [firstLng, firstLat] = coords[0];
        const [lastLng, lastLat] = coords[coords.length - 1];
        // Reject routes snapped to a completely different road network. Small
        // endpoint snapping is expected for buildings and off-road POIs.
        const startsNearOrigin =
          getHaversineDistance(startLat, startLng, firstLat, firstLng) <= 2000;
        const endsNearDestination =
          getHaversineDistance(endLat, endLng, lastLat, lastLng) <= 2000;
        return (
          startsNearOrigin &&
          endsNearDestination
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
      if (isCallerAbort(error, signal)) {
        throw error;
      }
      logger.warn(TAG, 'Online route request failed.', error);
      throw error;
    } finally {
      logger.performance(TAG, 'osrm.route', startedAt);
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
