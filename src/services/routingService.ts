import { formatDistance, formatDuration } from '../utils/locationUtils';
import {
  IRoutingRepository,
  NoRouteFoundError,
  OSRMPlanRoutingRepository,
  OfflineGraphRoutingRepository,
} from '../repositories/RoutingRepository';
import { connectivityService } from './connectivityService';
import { logger } from '../utils/logger';
import { offlineMapManager } from './offlineMapService';
import { TRAVEL_MODE_CONFIG, type TravelMode } from '../config/travelModes';

export class OfflineRoutingUnavailableError extends Error {
  constructor(
    message = 'Offline routing data is not installed. Downloaded maps can be viewed offline, but creating a new route still requires an internet connection.',
  ) {
    super(message);
    this.name = 'OfflineRoutingUnavailableError';
  }
}

export interface OSRMManeuver {
  type: string;
  modifier?: string;
  location?: [number, number];
  bearing_after?: number;
  bearing_before?: number;
  exit?: number;
}

export interface OSRMLane {
  indications?: string[];
  valid?: boolean;
}

export interface OSRMIntersection {
  lanes?: OSRMLane[];
}

export interface OSRMStep {
  distance: number;
  duration: number;
  name?: string;
  maneuver: OSRMManeuver;
  mode?: string;
  intersections?: OSRMIntersection[];
}

export interface LaneInstruction {
  lanes: string[];
  recommendedLaneIndex?: number;
}

export interface NavigationStep {
  instruction: string;
  distance: number;
  duration: number;
  type: string;
  modifier?: string;
  maneuver?: string;
  formattedDistance?: string;
  iconSymbol?: string;
  location?: [number, number];
  lanes?: LaneInstruction;
}

export interface RouteDetails {
  id?: string;
  name?: string;
  tag?: 'Fastest' | 'Shortest' | 'Alternative';
  coordinates: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  drivingDurationSeconds?: number;
  travelMode?: TravelMode;
  formattedDistance: string;
  formattedDuration: string;
  steps: NavigationStep[];
}

export interface RouteResult {
  distance: number;
  duration: number;
  geometry: [number, number][];
  steps: NavigationStep[];
}

export interface RoutingProvider {
  name: string;
  getRoute(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    signal?: AbortSignal,
  ): Promise<RouteDetails | null>;
  getRouteAlternatives?(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    signal?: AbortSignal,
  ): Promise<RouteDetails[]>;
}

function isValidRouteCoordinate(
  coordinate: unknown,
): coordinate is [number, number] {
  return (
    Array.isArray(coordinate) &&
    coordinate.length >= 2 &&
    typeof coordinate[0] === 'number' &&
    Number.isFinite(coordinate[0]) &&
    coordinate[0] >= -180 &&
    coordinate[0] <= 180 &&
    typeof coordinate[1] === 'number' &&
    Number.isFinite(coordinate[1]) &&
    coordinate[1] >= -90 &&
    coordinate[1] <= 90
  );
}

export function isValidRouteDetails(route: unknown): route is RouteDetails {
  if (!route || typeof route !== 'object') return false;
  const candidate = route as Partial<RouteDetails>;
  return (
    Array.isArray(candidate.coordinates) &&
    candidate.coordinates.length >= 2 &&
    candidate.coordinates.every(isValidRouteCoordinate) &&
    typeof candidate.distanceMeters === 'number' &&
    Number.isFinite(candidate.distanceMeters) &&
    candidate.distanceMeters > 0 &&
    typeof candidate.durationSeconds === 'number' &&
    Number.isFinite(candidate.durationSeconds) &&
    candidate.durationSeconds > 0 &&
    Array.isArray(candidate.steps)
  );
}

export function normalizeAndSortRoutes(routes: unknown): RouteDetails[] {
  if (!Array.isArray(routes)) return [];

  const normalized = routes
    .filter(isValidRouteDetails)
    .map(route => {
      const distanceMeters = Math.round(route.distanceMeters);
      const durationSeconds = Math.round(route.durationSeconds);
      return {
        ...route,
        coordinates: route.coordinates.map(
          coordinate => [coordinate[0], coordinate[1]] as [number, number],
        ),
        distanceMeters,
        durationSeconds,
        drivingDurationSeconds: route.drivingDurationSeconds ?? durationSeconds,
        travelMode: route.travelMode ?? 'driving',
        formattedDistance: formatDistance(distanceMeters),
        formattedDuration: formatDuration(durationSeconds),
        steps: route.steps,
      };
    })
    .sort((first, second) => {
      if (first.durationSeconds !== second.durationSeconds) {
        return first.durationSeconds - second.durationSeconds;
      }
      return first.distanceMeters - second.distanceMeters;
    });

  const shortestDistance = normalized.reduce(
    (minimum, route) => Math.min(minimum, route.distanceMeters),
    Infinity,
  );

  return normalized.map((route, index) => {
    const tag: RouteDetails['tag'] =
      index === 0
        ? 'Fastest'
        : route.distanceMeters === shortestDistance
        ? 'Shortest'
        : 'Alternative';
    return {
      ...route,
      tag,
      name: route.name || `Route ${index + 1} (${tag})`,
    };
  });
}

export function applyTravelModeToRoutes(
  routes: RouteDetails[],
  travelMode: TravelMode,
): RouteDetails[] {
  const modeConfig = TRAVEL_MODE_CONFIG[travelMode];
  const converted = routes
    .filter(isValidRouteDetails)
    .map(route => {
      const drivingDurationSeconds = Math.max(
        1,
        Math.round(route.drivingDurationSeconds ?? route.durationSeconds),
      );
      const durationSeconds = modeConfig.usesRoadDuration
        ? drivingDurationSeconds
        : Math.max(
            1,
            Math.round(
              route.distanceMeters / (modeConfig.baselineSpeedKmH / 3.6),
            ),
          );
      return {
        ...route,
        drivingDurationSeconds,
        travelMode,
        durationSeconds,
        formattedDuration: formatDuration(durationSeconds),
      };
    })
    .sort((first, second) => {
      if (first.durationSeconds !== second.durationSeconds) {
        return first.durationSeconds - second.durationSeconds;
      }
      return first.distanceMeters - second.distanceMeters;
    });

  const shortestDistance = converted.reduce(
    (minimum, route) => Math.min(minimum, route.distanceMeters),
    Infinity,
  );
  return converted.map((route, index) => {
    const tag: RouteDetails['tag'] =
      index === 0
        ? 'Fastest'
        : route.distanceMeters === shortestDistance
        ? 'Shortest'
        : 'Alternative';
    return {
      ...route,
      tag,
      name: `Route ${index + 1} (${tag})`,
    };
  });
}

function getManeuverIcon(type: string, modifier?: string): string {
  if (type === 'arrive') return '🏁';
  if (type === 'depart') return '🚗';
  if (type === 'roundabout' || type === 'rotary') return '🔄';

  if (modifier) {
    if (modifier.includes('right')) return '↱';
    if (modifier.includes('left')) return '↰';
    if (modifier.includes('straight')) return '↑';
  }

  return '↑';
}

function parseLaneInstructions(
  intersections?: OSRMIntersection[],
): LaneInstruction | undefined {
  const laneData = intersections?.find(
    intersection =>
      Array.isArray(intersection.lanes) && intersection.lanes.length > 0,
  )?.lanes;
  if (!laneData) return undefined;

  const lanes = laneData.map(lane => {
    const indications = Array.isArray(lane.indications) ? lane.indications : [];
    const indication =
      indications.find(value => value.includes('left')) ||
      indications.find(value => value.includes('right')) ||
      indications.find(value => value === 'straight') ||
      indications[0] ||
      'straight';
    if (indication.includes('left')) return 'left';
    if (indication.includes('right')) return 'right';
    return 'straight';
  });
  const recommendedIndex = laneData.findIndex(lane => lane.valid === true);

  return {
    lanes,
    recommendedLaneIndex: recommendedIndex >= 0 ? recommendedIndex : undefined,
  };
}

export function parseOSRMSteps(rawSteps: OSRMStep[]): NavigationStep[] {
  if (!Array.isArray(rawSteps)) return [];

  return rawSteps
    .filter(
      (step): step is OSRMStep =>
        !!step &&
        typeof step === 'object' &&
        !!step.maneuver &&
        typeof step.maneuver === 'object' &&
        typeof step.maneuver.type === 'string' &&
        typeof step.distance === 'number' &&
        Number.isFinite(step.distance) &&
        step.distance >= 0 &&
        typeof step.duration === 'number' &&
        Number.isFinite(step.duration) &&
        step.duration >= 0,
    )
    .map(step => {
      const type = step.maneuver?.type || 'straight';
      const modifier = step.maneuver?.modifier || '';
      const streetName = step.name ? ` onto ${step.name}` : '';
      const location = step.maneuver?.location;

      let instruction = 'Continue straight';

      if (type === 'depart') {
        instruction = `Start navigation${
          step.name ? ' - Head onto ' + step.name : ''
        }`.trim();
      } else if (type === 'arrive') {
        instruction = 'You have arrived at your destination';
      } else if (type === 'turn') {
        if (modifier.includes('right')) {
          instruction = `Turn right${streetName}`.trim();
        } else if (modifier.includes('left')) {
          instruction = `Turn left${streetName}`.trim();
        } else {
          instruction = `Turn ${modifier}${streetName}`.trim();
        }
      } else if (
        type === 'new name' ||
        type === 'continue' ||
        type === 'straight'
      ) {
        instruction = `Continue straight${streetName}`.trim();
      } else if (type === 'roundabout' || type === 'rotary') {
        const exitText =
          typeof step.maneuver.exit === 'number'
            ? ` and take exit ${step.maneuver.exit}`
            : '';
        instruction = `Enter the roundabout${exitText}${streetName}`.trim();
      } else if (type === 'merge') {
        instruction = `Merge ${modifier}${streetName}`.trim();
      } else if (type === 'fork') {
        instruction = `Keep ${modifier} at fork${streetName}`.trim();
      } else {
        instruction = `${type} ${modifier}${streetName}`.trim();
      }

      const distance = Math.round(step.distance || 0);
      const duration = Math.round(step.duration || 0);

      const lanes = parseLaneInstructions(step.intersections);

      return {
        instruction: instruction || 'Continue along route',
        distance,
        duration,
        type: type === 'turn' && modifier ? `turn-${modifier}` : type,
        modifier: modifier || undefined,
        maneuver: `${type} ${modifier}`.trim(),
        formattedDistance: formatDistance(distance),
        iconSymbol: getManeuverIcon(type, modifier),
        location,
        lanes,
      };
    });
}

export class OSRMOnlineRoutingProvider implements RoutingProvider {
  public name = 'OSRM Online Engine';
  private repo = new OSRMPlanRoutingRepository();

  async getRoute(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    signal?: AbortSignal,
  ): Promise<RouteDetails | null> {
    return this.repo.getRoute(startLat, startLng, endLat, endLng, signal);
  }

  async getRouteAlternatives(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    signal?: AbortSignal,
  ): Promise<RouteDetails[]> {
    return this.repo.getRouteAlternatives(
      startLat,
      startLng,
      endLat,
      endLng,
      signal,
    );
  }
}

export class OfflineRoutingProvider implements RoutingProvider {
  public name = 'Offline Local Graph Engine';
  private repo = new OfflineGraphRoutingRepository();

  async getRoute(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
  ): Promise<RouteDetails | null> {
    return this.repo.getRoute(startLat, startLng, endLat, endLng);
  }

  async getRouteAlternatives(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
  ): Promise<RouteDetails[]> {
    return this.repo.getRouteAlternatives(startLat, startLng, endLat, endLng);
  }
}

export class RoutingService {
  private onlineRepo: IRoutingRepository = new OSRMPlanRoutingRepository();
  private offlineRepo: IRoutingRepository = new OfflineGraphRoutingRepository();

  public setRepository(repository: IRoutingRepository) {
    this.onlineRepo = repository;
  }

  public setOnlineProvider(_provider: RoutingProvider) {
    // Kept for backward compatibility
  }

  public setOfflineProvider(_provider: RoutingProvider) {
    // Kept for backward compatibility
  }

  public async getRoute(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    signal?: AbortSignal,
  ): Promise<RouteDetails | null> {
    const routes = await this.getRouteAlternatives(
      startLat,
      startLng,
      endLat,
      endLng,
      signal,
    );
    return routes.length > 0 ? routes[0] : null;
  }

  public async getRouteAlternatives(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    signal?: AbortSignal,
  ): Promise<RouteDetails[]> {
    if (connectivityService.getMode() === 'offline') {
      return this.getOfflineRouteAlternatives(
        startLat,
        startLng,
        endLat,
        endLng,
        signal,
      );
    }

    try {
      const results = await this.onlineRepo.getRouteAlternatives(
        startLat,
        startLng,
        endLat,
        endLng,
        signal,
      );
      return normalizeAndSortRoutes(results);
    } catch (err) {
      if (
        err instanceof NoRouteFoundError ||
        (err &&
          typeof err === 'object' &&
          'name' in err &&
          (err as { name: string }).name === 'AbortError')
      ) {
        return [];
      }
      logger.warn('Routing', 'Online route search failed.', err);
      const networkReachable =
        connectivityService.getMode() === 'online'
          ? true
          : await connectivityService.verifyConnection();
      if (networkReachable) {
        // Never replace a failed online driving route with an estimated route
        // while online, and preserve the service error for the UI.
        throw err;
      }
    }

    return this.getOfflineRouteAlternatives(
      startLat,
      startLng,
      endLat,
      endLng,
      signal,
    );
  }

  private async getOfflineRouteAlternatives(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    signal?: AbortSignal,
  ): Promise<RouteDetails[]> {
    await offlineMapManager.initialize();
    offlineMapManager.assertNavigationCoverage(
      { latitude: startLat, longitude: startLng },
      { latitude: endLat, longitude: endLng },
    );
    const routes = normalizeAndSortRoutes(
      await this.offlineRepo.getRouteAlternatives(
        startLat,
        startLng,
        endLat,
        endLng,
        signal,
      ),
    );
    if (routes.length === 0) {
      throw new OfflineRoutingUnavailableError();
    }
    return routes;
  }
}

export const routingService = new RoutingService();

export async function getRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  signal?: AbortSignal,
): Promise<RouteDetails | null> {
  return routingService.getRoute(startLat, startLng, endLat, endLng, signal);
}

export async function getRouteAlternatives(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  signal?: AbortSignal,
): Promise<RouteDetails[]> {
  return routingService.getRouteAlternatives(
    startLat,
    startLng,
    endLat,
    endLng,
    signal,
  );
}

export const getRouteDetails = getRoute;
