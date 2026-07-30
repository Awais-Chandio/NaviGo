import { LOCATION_CONFIG } from '../config/locationConfig';
import { getDistanceToRoute } from '../utils/locationUtils';

export interface RerouteCheckResult {
  isOffRoute: boolean;
  distanceToRoute: number;
  shouldRecalculate: boolean;
  reason?: string;
}

export class ReroutingService {
  private deviationThresholdMeters: number;
  private cooldownMs: number;
  private confirmationDurationMs: number;
  private lastRerouteTimestamp: number = 0;
  private consecutiveOffRouteCount: number = 0;
  private firstOffRouteTimestamp: number = 0;
  private isReroutingInProgress: boolean = false;

  constructor(
    thresholdMeters = LOCATION_CONFIG.ROUTE_DEVIATION_THRESHOLD_METERS,
    cooldownMs = LOCATION_CONFIG.REROUTE_COOLDOWN_MS,
    confirmationDurationMs = LOCATION_CONFIG.OFF_ROUTE_CONFIRMATION_MS,
  ) {
    this.deviationThresholdMeters = thresholdMeters;
    this.cooldownMs = cooldownMs;
    this.confirmationDurationMs = confirmationDurationMs;
  }

  public checkDeviation(
    userLat: number,
    userLng: number,
    activeRouteCoordinates: [number, number][],
    knownDistanceToRoute?: number,
    timestampMs = Date.now(),
    accuracyMeters = 0,
  ): RerouteCheckResult {
    if (!activeRouteCoordinates || activeRouteCoordinates.length < 2) {
      return {
        isOffRoute: false,
        distanceToRoute: 0,
        shouldRecalculate: false,
      };
    }

    const distanceToRoute =
      typeof knownDistanceToRoute === 'number' &&
      Number.isFinite(knownDistanceToRoute) &&
      knownDistanceToRoute >= 0
        ? knownDistanceToRoute
        : getDistanceToRoute(userLat, userLng, activeRouteCoordinates);

    const effectiveThresholdMeters = Math.max(
      this.deviationThresholdMeters,
      Number.isFinite(accuracyMeters) && accuracyMeters > 0
        ? accuracyMeters * 1.5
        : 0,
    );
    const isOffRoute = distanceToRoute > effectiveThresholdMeters;
    const now = timestampMs;

    if (!isOffRoute) {
      this.consecutiveOffRouteCount = 0;
      this.firstOffRouteTimestamp = 0;
      return {
        isOffRoute: false,
        distanceToRoute,
        shouldRecalculate: false,
      };
    }

    if (this.consecutiveOffRouteCount === 0) {
      this.firstOffRouteTimestamp = now;
    }
    this.consecutiveOffRouteCount += 1;

    if (this.isReroutingInProgress) {
      return {
        isOffRoute: true,
        distanceToRoute,
        shouldRecalculate: false,
        reason: 'Reroute already in progress',
      };
    }

    const timeSinceLastReroute = now - this.lastRerouteTimestamp;
    if (timeSinceLastReroute < this.cooldownMs) {
      return {
        isOffRoute: true,
        distanceToRoute,
        shouldRecalculate: false,
        reason: `Cooldown active (${Math.round((this.cooldownMs - timeSinceLastReroute) / 1000)}s left)`,
      };
    }

    // Require both multiple accepted fixes and a sustained duration. A burst of
    // noisy callbacks must not trigger a route request.
    const offRouteDurationMs = now - this.firstOffRouteTimestamp;
    if (
      this.consecutiveOffRouteCount < 3 ||
      offRouteDurationMs < this.confirmationDurationMs
    ) {
      return {
        isOffRoute: true,
        distanceToRoute,
        shouldRecalculate: false,
        reason: `Waiting for sustained confirmation (${this.consecutiveOffRouteCount}/3 fixes, ${Math.round(offRouteDurationMs / 1000)}s/${Math.round(this.confirmationDurationMs / 1000)}s)`,
      };
    }

    return {
      isOffRoute: true,
      distanceToRoute,
      shouldRecalculate: true,
      reason: `User deviated from route beyond ${Math.round(effectiveThresholdMeters)}m threshold for ${Math.round(offRouteDurationMs / 1000)}s (${this.consecutiveOffRouteCount} fixes)`,
    };
  }

  public markRerouteStarted() {
    this.isReroutingInProgress = true;
    this.lastRerouteTimestamp = Date.now();
  }

  public markRerouteCompleted() {
    this.isReroutingInProgress = false;
    this.resetDeviationTracking();
  }

  public resetDeviationTracking() {
    this.consecutiveOffRouteCount = 0;
    this.firstOffRouteTimestamp = 0;
  }

  public reset() {
    this.lastRerouteTimestamp = 0;
    this.resetDeviationTracking();
    this.isReroutingInProgress = false;
  }
}

export const reroutingService = new ReroutingService();
