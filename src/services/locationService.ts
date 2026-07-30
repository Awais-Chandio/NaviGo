import Geolocation, { GeoPosition } from 'react-native-geolocation-service';
import { RequestLocationPermission } from '../permissions/locationPermission';

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading?: number | null;
  speed?: number | null;
}

const MAX_ACCURACY_THRESHOLD = 35;

export function isLocationAccurate(position: GeoPosition): boolean {
  if (!position?.coords) return false;
  const accuracy = position.coords.accuracy;
  return typeof accuracy === 'number' && accuracy <= MAX_ACCURACY_THRESHOLD;
}

export async function getCurrentLocationFix(): Promise<LocationData | null> {
  const granted = await RequestLocationPermission();
  if (!granted) return null;

  return new Promise(resolve => {
    Geolocation.getCurrentPosition(
      position => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
        });
      },
      error => {
        console.warn('getCurrentLocationFix Error:', error.message);
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
        distanceFilter: 5,
        forceRequestLocation: true,
        showLocationDialog: true,
      },
    );
  });
}

export function watchLocationUpdates(
  onLocation: (loc: LocationData) => void,
  onError?: (err: any) => void,
): number {
  return Geolocation.watchPosition(
    position => {
      if (!isLocationAccurate(position)) {
        console.warn(
          `[GPS Filter] Ignored inaccurate fix: accuracy=${position.coords.accuracy}m`,
        );
        return;
      }

      onLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
      });
    },
    error => {
      if (onError) onError(error);
    },
    {
      enableHighAccuracy: true,
      distanceFilter: 5,
      interval: 3000,
      fastestInterval: 1500,
      forceRequestLocation: true,
      showLocationDialog: true,
    },
  );
}

export function stopLocationWatch(watchId: number | null) {
  if (watchId !== null) {
    Geolocation.clearWatch(watchId);
  }
}
