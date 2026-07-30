import {
  buildRouteGeometryMetrics,
  findClosestPointOnRoute,
  getHaversineDistance,
  getPointAtRouteDistance,
  type RouteGeometryMetrics,
} from '../utils/locationUtils';
import { NavigationStep } from './routingService';

export interface MatchedLocation {
  latitude: number;
  longitude: number;
  roadName: string;
  confidence: number; // 0.0 to 1.0
  segmentIndex?: number;
  distanceToRoute?: number;
  distanceAlongRoute?: number;
}

export interface MapMatchingProvider {
  name: string;
  match(
    latitude: number,
    longitude: number,
    routeCoordinates: [number, number][],
    steps?: NavigationStep[],
    lastSegmentIndex?: number,
    timestampMs?: number,
  ): Promise<MatchedLocation>;
}

export class GeometricMapMatchingProvider implements MapMatchingProvider {
  public name = 'Geometric Polyline Snapping';
  private lastDistanceAlongRoute: number | null = null;
  private lastMatchTimestamp = 0;
  private lastInputLocation: { latitude: number; longitude: number } | null =
    null;
  private cachedCoordinates: [number, number][] | null = null;
  private cachedMetrics: RouteGeometryMetrics | null = null;

  private getMetrics(
    routeCoordinates: [number, number][],
  ): RouteGeometryMetrics {
    if (
      this.cachedCoordinates !== routeCoordinates ||
      this.cachedMetrics === null
    ) {
      this.cachedCoordinates = routeCoordinates;
      this.cachedMetrics = buildRouteGeometryMetrics(routeCoordinates);
      this.lastDistanceAlongRoute = null;
      this.lastMatchTimestamp = 0;
      this.lastInputLocation = null;
    }
    return this.cachedMetrics;
  }

  async match(
    latitude: number,
    longitude: number,
    routeCoordinates: [number, number][],
    steps: NavigationStep[] = [],
    lastSegmentIndex?: number,
    timestampMs = Date.now(),
  ): Promise<MatchedLocation> {
    if (!routeCoordinates || routeCoordinates.length < 2) {
      return {
        latitude,
        longitude,
        roadName: 'Current Location',
        confidence: 0.5,
        segmentIndex: 0,
        distanceToRoute: 0,
        distanceAlongRoute: 0,
      };
    }

    const metrics = this.getMetrics(routeCoordinates);
    const inputMovementMeters = this.lastInputLocation
      ? getHaversineDistance(
          this.lastInputLocation.latitude,
          this.lastInputLocation.longitude,
          latitude,
          longitude,
        )
      : 0;
    this.lastInputLocation = { latitude, longitude };
    const finalSegmentIndex = routeCoordinates.length - 2;
    const hasPreviousSegment =
      typeof lastSegmentIndex === 'number' && lastSegmentIndex >= 0;
    const startIndex = hasPreviousSegment
      ? Math.max(0, lastSegmentIndex - 1)
      : 0;
    const endIndex = hasPreviousSegment
      ? Math.min(finalSegmentIndex, lastSegmentIndex + 25)
      : finalSegmentIndex;
    const localProjection = findClosestPointOnRoute(
      latitude,
      longitude,
      routeCoordinates,
      metrics,
      startIndex,
      endIndex,
    );
    const globalProjection =
      startIndex === 0 && endIndex === finalSegmentIndex
        ? localProjection
        : findClosestPointOnRoute(
            latitude,
            longitude,
            routeCoordinates,
            metrics,
          );

    let selectedProjection = localProjection;
    if (
      hasPreviousSegment &&
      globalProjection.distanceMeters + 10 < localProjection.distanceMeters &&
      globalProjection.segmentIndex >= lastSegmentIndex
    ) {
      const elapsedSeconds =
        this.lastMatchTimestamp > 0
          ? Math.max(
              0,
              Math.min(10, (timestampMs - this.lastMatchTimestamp) / 1000),
            )
          : 0;
      const maximumPlausibleAdvance =
        this.lastDistanceAlongRoute === null
          ? 75
          : Math.max(
              30,
              Math.min(
                elapsedSeconds * 60 + 30,
                inputMovementMeters * 2 + 30,
              ),
            );
      const previousDistance =
        this.lastDistanceAlongRoute ??
        metrics.cumulativeDistances[lastSegmentIndex] ??
        0;

      // Reacquire farther ahead only when the along-route change is physically
      // plausible. This avoids snapping to a crossing or parallel road segment.
      if (
        globalProjection.distanceAlongRoute >= previousDistance - 10 &&
        globalProjection.distanceAlongRoute <=
          previousDistance + maximumPlausibleAdvance
      ) {
        selectedProjection = globalProjection;
      }
    }

    // Maximum distance in meters beyond which confidence becomes 0 and raw location is used
    const MAX_SNAP_DISTANCE_METERS = 50;

    if (globalProjection.distanceMeters > MAX_SNAP_DISTANCE_METERS) {
      return {
        latitude,
        longitude,
        roadName: 'Off Route',
        confidence: 0.0,
        segmentIndex: lastSegmentIndex ?? selectedProjection.segmentIndex,
        distanceToRoute: globalProjection.distanceMeters,
        distanceAlongRoute: this.lastDistanceAlongRoute ?? 0,
      };
    }

    const confidence = Math.max(
      0,
      1 - selectedProjection.distanceMeters / MAX_SNAP_DISTANCE_METERS,
    );
    let smoothedDistanceAlongRoute = selectedProjection.distanceAlongRoute;

    if (this.lastDistanceAlongRoute !== null) {
      const nonRegressingDistance = Math.max(
        this.lastDistanceAlongRoute,
        selectedProjection.distanceAlongRoute,
      );
      const advance = nonRegressingDistance - this.lastDistanceAlongRoute;
      // Smooth along the polyline rather than interpolating latitude/longitude.
      // This keeps the displayed point on-route through bends.
      const smoothingAlpha = advance > 30 ? 0.75 : 0.6;
      smoothedDistanceAlongRoute =
        this.lastDistanceAlongRoute + advance * smoothingAlpha;
    }
    this.lastDistanceAlongRoute = smoothedDistanceAlongRoute;
    this.lastMatchTimestamp = timestampMs;
    const smoothedPoint = getPointAtRouteDistance(
      routeCoordinates,
      smoothedDistanceAlongRoute,
      metrics,
    );

    // Determine road name based on nearest step instruction
    let roadName = 'Current Route';
    if (steps && steps.length > 0) {
      const stepIndex = Math.min(
        Math.floor(
          (smoothedPoint.segmentIndex / (routeCoordinates.length - 1)) *
            steps.length,
        ),
        steps.length - 1,
      );
      if (steps[stepIndex]?.instruction) {
        const fullInstr = steps[stepIndex].instruction;
        const ontoMatch = fullInstr.match(/onto (.*)$/i);
        if (ontoMatch && ontoMatch[1]) {
          roadName = ontoMatch[1];
        } else {
          roadName = fullInstr;
        }
      }
    }

    return {
      latitude: smoothedPoint.latitude,
      longitude: smoothedPoint.longitude,
      roadName,
      confidence: Number(confidence.toFixed(2)),
      segmentIndex: smoothedPoint.segmentIndex,
      distanceToRoute: globalProjection.distanceMeters,
      distanceAlongRoute: smoothedDistanceAlongRoute,
    };
  }

  public reset() {
    this.lastDistanceAlongRoute = null;
    this.lastMatchTimestamp = 0;
    this.lastInputLocation = null;
    this.cachedCoordinates = null;
    this.cachedMetrics = null;
  }
}

/**
 * Future API extension for OSRM Match API
 */
export class OSRMMatchProvider implements MapMatchingProvider {
  public name = 'OSRM Match API';
  private fallback = new GeometricMapMatchingProvider();

  async match(
    latitude: number,
    longitude: number,
    routeCoordinates: [number, number][],
    steps: NavigationStep[] = [],
    lastSegmentIndex?: number,
    timestampMs?: number,
  ): Promise<MatchedLocation> {
    return this.fallback.match(
      latitude,
      longitude,
      routeCoordinates,
      steps,
      lastSegmentIndex,
      timestampMs,
    );
  }
}

export class MapMatchingService {
  private activeProvider: MapMatchingProvider = new GeometricMapMatchingProvider();

  public setProvider(provider: MapMatchingProvider) {
    this.activeProvider = provider;
  }

  public async snapToRoute(
    latitude: number,
    longitude: number,
    routeCoordinates: [number, number][],
    steps?: NavigationStep[],
    lastSegmentIndex?: number,
    timestampMs?: number,
  ): Promise<MatchedLocation> {
    return this.activeProvider.match(
      latitude,
      longitude,
      routeCoordinates,
      steps,
      lastSegmentIndex,
      timestampMs,
    );
  }

  public reset() {
    const resettableProvider = this.activeProvider as MapMatchingProvider & {
      reset?: () => void;
    };
    if (typeof resettableProvider.reset === 'function') {
      resettableProvider.reset();
    }
  }
}

export const mapMatchingService = new MapMatchingService();
