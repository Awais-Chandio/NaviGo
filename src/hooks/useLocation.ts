import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LocationData,
  getCurrentLocationFix,
  watchLocationUpdates,
  stopLocationWatch,
} from '../services/locationService';
import { reverseGeocodeDetails } from '../services/searchService';
import { RequestLocationPermission } from '../permissions/locationPermission';
import { getHaversineDistance } from '../utils/locationUtils';
import { LOCATION_CONFIG } from '../config/locationConfig';
import { logger } from '../utils/logger';

export function useLocation(isNavigating = false) {
  const [location, setLocation] = useState<LocationData>({
    latitude: 25.396,
    longitude: 68.3578,
    accuracy: 0,
    heading: 0,
  });

  const [address, setAddress] = useState<string>('');
  const [detectedArea, setDetectedArea] = useState<string>('');
  const [detectedCity, setDetectedCity] = useState<string>('');
  const [detectedCountryCode, setDetectedCountryCode] = useState<string>('');
  const [locationError, setLocationError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const reverseAbortRef = useRef<AbortController | null>(null);
  const reverseSequenceRef = useRef<number>(0);
  const lastGeocodedCoordsRef = useRef<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const updateAddressIfNeeded = useCallback(
    async (latitude: number, longitude: number) => {
      if (lastGeocodedCoordsRef.current) {
        const dist = getHaversineDistance(
          lastGeocodedCoordsRef.current.latitude,
          lastGeocodedCoordsRef.current.longitude,
          latitude,
          longitude,
        );
        if (dist < LOCATION_CONFIG.ADDRESS_GEOCODE_THRESHOLD_METERS) return;
      }

      reverseAbortRef.current?.abort();
      const controller = new AbortController();
      reverseAbortRef.current = controller;
      const sequence = ++reverseSequenceRef.current;
      try {
        const res = await reverseGeocodeDetails(
          latitude,
          longitude,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          !isMountedRef.current ||
          sequence !== reverseSequenceRef.current
        ) {
          return;
        }
        lastGeocodedCoordsRef.current = { latitude, longitude };
        setAddress(res.displayName);
        if (res.detectedArea) {
          setDetectedArea(res.detectedArea);
        }
        setDetectedCity(res.city ?? '');
        setDetectedCountryCode(res.countryCode ?? '');
      } catch (err) {
        if (
          err &&
          typeof err === 'object' &&
          'name' in err &&
          (err as { name: string }).name === 'AbortError'
        ) {
          return;
        }
        logger.warn('GPS', 'Reverse geocoding failed.', err);
      } finally {
        if (reverseAbortRef.current === controller) {
          reverseAbortRef.current = null;
        }
      }
    },
    [],
  );

  const startTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      stopLocationWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    const interval = isNavigating
      ? LOCATION_CONFIG.NAVIGATION_LOCATION_INTERVAL
      : LOCATION_CONFIG.NORMAL_LOCATION_INTERVAL;

    watchIdRef.current = watchLocationUpdates(
      newLoc => {
        if (!isMountedRef.current) return;
        setLocation(prev => {
          if (
            prev &&
            Math.abs(prev.latitude - newLoc.latitude) < 0.000005 &&
            Math.abs(prev.longitude - newLoc.longitude) < 0.000005 &&
            prev.heading === newLoc.heading &&
            prev.accuracy === newLoc.accuracy &&
            prev.speed === newLoc.speed &&
            prev.timestamp === newLoc.timestamp
          ) {
            return prev;
          }
          return newLoc;
        });
        setLocationError(null);
        updateAddressIfNeeded(newLoc.latitude, newLoc.longitude);
      },
      err => {
        if (!isMountedRef.current) return;
        logger.warn('GPS', 'Location watch failed.', err);
        const errMsg =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'GPS location update failed';
        setLocationError(errMsg);
      },
      {
        interval,
        fastestInterval: Math.round(interval / 2),
        distanceFilter: isNavigating
          ? 2
          : LOCATION_CONFIG.GPS_DISTANCE_FILTER_METERS,
      },
    );
  }, [isNavigating, updateAddressIfNeeded]);

  const refreshLocation = useCallback(async () => {
    const loc = await getCurrentLocationFix();
    if (!isMountedRef.current) return;
    if (loc) {
      setLocation(loc);
      setLocationError(null);
      updateAddressIfNeeded(loc.latitude, loc.longitude);
    } else {
      setLocationError('Location permission denied or GPS fix failed');
    }
  }, [updateAddressIfNeeded]);

  useEffect(() => {
    let isMounted = true;
    isMountedRef.current = true;

    async function initLocation() {
      const granted = await RequestLocationPermission();
      if (!isMounted) return;

      if (!granted) {
        setLocationError('Location permission denied');
        return;
      }

      setLocationError(null);
      refreshLocation();
      startTracking();
    }

    initLocation();

    return () => {
      isMounted = false;
      isMountedRef.current = false;
      reverseSequenceRef.current += 1;
      reverseAbortRef.current?.abort();
      reverseAbortRef.current = null;
      if (watchIdRef.current !== null) {
        stopLocationWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [isNavigating, refreshLocation, startTracking]);

  return {
    location,
    address,
    detectedArea,
    detectedCity,
    detectedCountryCode,
    locationError,
    refreshLocation,
  };
}
