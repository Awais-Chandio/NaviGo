import Geolocation, { GeoPosition } from 'react-native-geolocation-service';
import { RequestLocationPermission } from '../permissions/locationPermission';
import { LOCATION_CONFIG } from '../config/locationConfig';
import { isGPSJump, isValidCoordinate } from '../utils/locationUtils';
import { logger } from '../utils/logger';

const TAG = 'GPS';

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading?: number | null;
  speed?: number | null;
  timestamp?: number;
}

export function isLocationAccurate(position: GeoPosition): boolean {
  if (!position?.coords) return false;
  const accuracy = position.coords.accuracy;
  return (
    isValidCoordinate(
      position.coords.latitude,
      position.coords.longitude,
      true,
    ) &&
    typeof accuracy === 'number' &&
    Number.isFinite(accuracy) &&
    accuracy > 0 &&
    accuracy <= LOCATION_CONFIG.GPS_ACCURACY_MAX_THRESHOLD_METERS
  );
}

export async function getCurrentLocationFix(): Promise<LocationData | null> {
  const granted = await RequestLocationPermission();
  if (!granted) return null;

  return new Promise(resolve => {
    Geolocation.getCurrentPosition(
      position => {
        if (!isLocationAccurate(position)) {
          logger.warn(TAG, 'Ignored inaccurate current GPS fix.', {
            accuracyMeters: position.coords.accuracy,
          });
          resolve(null);
          return;
        }
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          timestamp: position.timestamp || Date.now(),
        });
      },
      error => {
        logger.warn(TAG, 'Current location request failed.', {
          code: error.code,
          message: error.message,
        });
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
        distanceFilter: LOCATION_CONFIG.GPS_DISTANCE_FILTER_METERS,
        forceRequestLocation: true,
        showLocationDialog: true,
      },
    );
  });
}

export interface WatchLocationOptions {
  interval?: number;
  fastestInterval?: number;
  distanceFilter?: number;
}

let activeWatchToken: number | null = null;
let nextWatchToken = 1;
const nativeWatchIds = new Map<number, number>();
const cancelledWatchTokens = new Set<number>();
let lastEmittedLocation: LocationData | null = null;

export interface LocationErrorPayload {
  code: number;
  message: string;
  type: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'UNKNOWN';
}

export function watchLocationUpdates(
  onLocation: (loc: LocationData) => void,
  onError?: (err: LocationErrorPayload) => void,
  options?: WatchLocationOptions,
): number {
  if (activeWatchToken !== null) {
    stopLocationWatch(activeWatchToken);
  }
  const watchToken = nextWatchToken++;
  activeWatchToken = watchToken;
  lastEmittedLocation = null;
  let inaccurateFixCount = 0;

  const watchInterval = options?.interval ?? LOCATION_CONFIG.NORMAL_LOCATION_INTERVAL;
  const watchFastest = options?.fastestInterval ?? Math.round(watchInterval / 2);
  const distanceFilter = options?.distanceFilter ?? LOCATION_CONFIG.GPS_DISTANCE_FILTER_METERS;

  // Verify permission asynchronously before invoking native watcher
  RequestLocationPermission().then(granted => {
    if (!granted) {
      cancelledWatchTokens.delete(watchToken);
      if (activeWatchToken === watchToken) {
        activeWatchToken = null;
      }
      if (onError) {
        onError({
          code: 1,
          message: 'Location permission not granted',
          type: 'PERMISSION_DENIED',
        });
      }
      return;
    }

    const watchId = Geolocation.watchPosition(
      position => {
        if (!isLocationAccurate(position)) {
          inaccurateFixCount += 1;
          if (inaccurateFixCount === 3 && onError) {
            onError({
              code: 2,
              message: `GPS accuracy is too low (${Math.round(position.coords.accuracy)}m). Move to an open area.`,
              type: 'POSITION_UNAVAILABLE',
            });
          }
          return;
        }
        inaccurateFixCount = 0;

        const newTime = position.timestamp || Date.now();

        const newLoc: LocationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          timestamp: newTime,
        };

        if (lastEmittedLocation) {
          if (
            (newLoc.timestamp || 0) <=
            (lastEmittedLocation.timestamp || 0)
          ) {
            return;
          }

          // Reject sudden GPS jumps (>180 km/h or >100m in <1s)
          const lastTime = lastEmittedLocation.timestamp || (newTime - 1000);
          const isJump = isGPSJump(
            lastEmittedLocation.latitude,
            lastEmittedLocation.longitude,
            lastTime,
            newLoc.latitude,
            newLoc.longitude,
            newTime,
            LOCATION_CONFIG.GPS_MAX_PLAUSIBLE_SPEED_MPS,
          );

          if (isJump) {
            logger.warn(TAG, 'Rejected implausible GPS jump.', {
              accuracyMeters: newLoc.accuracy,
              timestamp: newLoc.timestamp,
            });
            return;
          }
        }

        lastEmittedLocation = newLoc;
        logger.debug(TAG, 'Accepted location update.', {
          accuracyMeters: newLoc.accuracy,
          hasHeading: typeof newLoc.heading === 'number',
          hasSpeed: typeof newLoc.speed === 'number',
        });
        onLocation(newLoc);
      },
      error => {
        if (onError) {
          let errType: LocationErrorPayload['type'] = 'UNKNOWN';
          if (error.code === 1) errType = 'PERMISSION_DENIED';
          else if (error.code === 2) errType = 'POSITION_UNAVAILABLE';
          else if (error.code === 3) errType = 'TIMEOUT';

          onError({
            code: error.code || 0,
            message: error.message || 'GPS location error',
            type: errType,
          });
        }
      },
      {
        enableHighAccuracy: true,
        distanceFilter,
        interval: watchInterval,
        fastestInterval: watchFastest,
        forceRequestLocation: false,
        showLocationDialog: true,
      },
    );

    if (cancelledWatchTokens.has(watchToken)) {
      Geolocation.clearWatch(watchId);
      cancelledWatchTokens.delete(watchToken);
      return;
    }
    nativeWatchIds.set(watchToken, watchId);
  }).catch(error => {
    cancelledWatchTokens.delete(watchToken);
    if (activeWatchToken === watchToken) {
      activeWatchToken = null;
    }
    onError?.({
      code: 0,
      message:
        error instanceof Error
          ? error.message
          : 'Unable to verify location permission',
      type: 'UNKNOWN',
    });
  });

  // Return a stable token immediately; permission resolution may complete later.
  return watchToken;
}

export function stopLocationWatch(watchToken: number | null) {
  if (watchToken !== null) {
    const nativeWatchId = nativeWatchIds.get(watchToken);
    if (typeof nativeWatchId === 'number') {
      Geolocation.clearWatch(nativeWatchId);
      nativeWatchIds.delete(watchToken);
    } else {
      cancelledWatchTokens.add(watchToken);
    }
    if (activeWatchToken === watchToken) {
      activeWatchToken = null;
      lastEmittedLocation = null;
    }
  }
}
