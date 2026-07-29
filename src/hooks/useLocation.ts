import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LocationData,
  getCurrentLocationFix,
  watchLocationUpdates,
  stopLocationWatch,
} from '../services/locationService';
import { reverseGeocode } from '../services/searchService';
import { getHaversineDistance } from '../utils/locationUtils';

export function useLocation() {
  const [location, setLocation] = useState<LocationData>({
    latitude: 25.396,
    longitude: 68.3578,
    accuracy: 0,
    heading: 0,
  });

  const [address, setAddress] = useState<string>('');
  const watchIdRef = useRef<number | null>(null);
  const lastGeocodedCoordsRef = useRef<{
    latitude: number;
    longitude: number;
  } | null>(null);

  /**
   * Only fetches reverse geocode address if moved > 50 meters.
   */
  const updateAddressIfNeeded = useCallback(
    async (latitude: number, longitude: number) => {
      if (lastGeocodedCoordsRef.current) {
        const dist = getHaversineDistance(
          lastGeocodedCoordsRef.current.latitude,
          lastGeocodedCoordsRef.current.longitude,
          latitude,
          longitude,
        );
        if (dist < 50) return;
      }

      lastGeocodedCoordsRef.current = { latitude, longitude };
      const currentAddress = await reverseGeocode(latitude, longitude);
      setAddress(currentAddress);
    },
    [],
  );

  const startTracking = useCallback(() => {
    if (watchIdRef.current !== null) return;

    watchIdRef.current = watchLocationUpdates(newLoc => {
      setLocation(newLoc);
      updateAddressIfNeeded(newLoc.latitude, newLoc.longitude);
    });
  }, [updateAddressIfNeeded]);

  const refreshLocation = useCallback(async () => {
    const loc = await getCurrentLocationFix();
    if (loc) {
      setLocation(loc);
      updateAddressIfNeeded(loc.latitude, loc.longitude);
    }
  }, [updateAddressIfNeeded]);

  useEffect(() => {
    refreshLocation();
    startTracking();

    return () => {
      stopLocationWatch(watchIdRef.current);
      watchIdRef.current = null;
    };
  }, [refreshLocation, startTracking]);

  return {
    location,
    address,
    refreshLocation,
  };
}
