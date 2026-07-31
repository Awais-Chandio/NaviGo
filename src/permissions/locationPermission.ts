import { check, checkMultiple, PERMISSIONS, request, requestMultiple, RESULTS } from 'react-native-permissions';
import { Alert, Platform } from 'react-native';
import { logger } from '../utils/logger';

const TAG = 'LocationPermission';

let activePermissionPromise: Promise<boolean> | null = null;

export async function checkLocationPermissionStatus(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      const statuses = await checkMultiple([
        PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
        PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION,
      ]);
      const fineGranted = statuses[PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION] === RESULTS.GRANTED;
      return fineGranted;
    } else {
      const status = await check(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
      return status === RESULTS.GRANTED;
    }
  } catch (err) {
    logger.warn(TAG, 'Unable to check location permission status.', err);
    return false;
  }
}

export async function RequestLocationPermission(): Promise<boolean> {
  if (activePermissionPromise) {
    return activePermissionPromise;
  }

  activePermissionPromise = (async () => {
    try {
      if (Platform.OS === 'android') {
        const androidPermissions = [
          PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
          PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION,
        ];

        const statuses = await checkMultiple(androidPermissions);
        const fine = statuses[PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION];
        const coarse = statuses[PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION];

        if (fine === RESULTS.GRANTED) {
          return true;
        }

        if (fine === RESULTS.BLOCKED && coarse === RESULTS.BLOCKED) {
          Alert.alert('Permission Blocked', 'Location permission is permanently blocked. Please enable it in device settings.');
          return false;
        }

        const requestResults = await requestMultiple(androidPermissions);
        const fineReq = requestResults[PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION];
        const coarseReq = requestResults[PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION];

        if (fineReq === RESULTS.GRANTED) {
          return true;
        }
        if (coarseReq === RESULTS.GRANTED) {
          Alert.alert(
            'Precise Location Required',
            'NaviGo needs precise location for safe route progress and nearby results. Enable precise location in system settings.',
          );
        }
        return false;
      } else {
        const status = await check(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
        if (status === RESULTS.GRANTED) {
          return true;
        }
        if (status === RESULTS.BLOCKED) {
          Alert.alert('Permission Blocked', 'Please enable location permission in Settings.');
          return false;
        }
        const req = await request(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
        return req === RESULTS.GRANTED;
      }
    } catch (error) {
      logger.warn(TAG, 'Location permission request failed.', error);
      return false;
    } finally {
      activePermissionPromise = null;
    }
  })();

  return activePermissionPromise;
}

export function resetPermissionCache(): void {
  // Retained for API compatibility. Permission state is always rechecked.
}
