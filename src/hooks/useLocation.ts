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
    // Zero is an explicit "no fix yet" sentinel and is rejected by every
    // place/search/navigation boundary until native GPS supplies real data.
    latitude: 0,
    longitude: 0,
    accuracy: 0,
    heading: 0,
  });

  const [address, setAddress] = useState<string>('');
  const [detectedArea, setDetectedArea] = useState<string>('');
  const [detectedCity, setDetectedCity] = useState<string>('');
  const [detectedCountryCode, setDetectedCountryCode] = useState<string>('');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [hasLocationFix, setHasLocationFix] = useState<boolean>(false);
  const watchIdRef = useRef<number | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const reverseAbortRef = useRef<AbortController | null>(null);
  const reverseSequenceRef = useRef<number>(0);
  const lastAcceptedLocationRef = useRef<LocationData | null>(null);
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
      // The previous area's metadata must not constrain searches around a new
      // GPS fix while reverse geocoding is still in flight (for example after
      // crossing a country border or changing an emulator location).
      setAddress('');
      setDetectedArea('');
      setDetectedCity('');
      setDetectedCountryCode('');
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

  const acceptLocation = useCallback(
    (newLoc: LocationData) => {
      if (!isMountedRef.current) return;
      const timestamp = newLoc.timestamp || Date.now();
      const previousTimestamp = lastAcceptedLocationRef.current?.timestamp || 0;

      // The startup one-shot request and native watcher run concurrently. A
      // delayed cached one-shot response must never replace a newer watch fix.
      if (timestamp <= previousTimestamp) return;

      const accepted = { ...newLoc, timestamp };
      lastAcceptedLocationRef.current = accepted;
      setLocation(accepted);
      setHasLocationFix(true);
      setLocationError(null);
      updateAddressIfNeeded(accepted.latitude, accepted.longitude);
    },
    [updateAddressIfNeeded],
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
        acceptLocation(newLoc);
      },
      err => {
        if (!isMountedRef.current) return;
        logger.warn('GPS', 'Location watch failed.', err);
        // A stationary device may not emit another callback because the native
        // distance filter suppresses unchanged fixes. Preserve the last known
        // accurate fix for transient timeout/unavailable errors; only a
        // permission revocation makes it unusable immediately.
        if (err.type === 'PERMISSION_DENIED') {
          setHasLocationFix(false);
        } else if (lastAcceptedLocationRef.current) {
          return;
        }
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
  }, [acceptLocation, isNavigating]);

  const refreshLocation = useCallback(async () => {
    const loc = await getCurrentLocationFix();
    if (!isMountedRef.current) return;
    if (loc) {
      acceptLocation(loc);
    } else {
      // A failed manual refresh must not discard a previously accepted fix.
      if (!lastAcceptedLocationRef.current) {
        setHasLocationFix(false);
        setLocationError('Location permission denied or GPS fix failed');
      }
    }
  }, [acceptLocation]);

  useEffect(() => {
    let isMounted = true;
    isMountedRef.current = true;

    async function initLocation() {
      const granted = await RequestLocationPermission();
      if (!isMounted) return;

      if (!granted) {
        setHasLocationFix(false);
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
    hasLocationFix,
    refreshLocation,
  };
}
