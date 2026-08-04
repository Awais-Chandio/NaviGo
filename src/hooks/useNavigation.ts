import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import {
  getRouteAlternatives,
  applyTravelModeToRoutes,
  OfflineRoutingUnavailableError,
  type RouteDetails,
  type NavigationStep,
} from '../services/routingService';
import { voiceNavigationService } from '../services/VoiceNavigationService';
import { navigationStore } from '../store/navigationStore';
import {
  mapMatchingService,
  MatchedLocation,
} from '../services/MapMatchingService';
import { reroutingService } from '../services/ReroutingService';
import {
  calculateBearing,
  calculateRouteProgress,
  calculateDynamicETA,
  calculateSpeed,
  buildRouteGeometryMetrics,
  findClosestPointOnRoute,
  getHaversineDistance,
  formatDistance,
  formatDuration,
  isGPSJump,
  smoothBearing,
} from '../utils/locationUtils';
import { logger } from '../utils/logger';
import { LOCATION_CONFIG } from '../config/locationConfig';
import { connectivityService } from '../services/connectivityService';
import {
  OfflineCoverageError,
  offlineMapManager,
} from '../services/offlineMapService';
import { type TravelMode } from '../config/travelModes';

export type NavigationState =
  | 'idle'
  | 'route_ready'
  | 'navigating'
  | 'arrived'
  | 'cancelled';

export interface DestinationInfo {
  latitude: number;
  longitude: number;
  title: string;
  subtitle: string;
}

const STEP_COMPLETION_THRESHOLD_METERS = 25;
const MIN_SPEED_FOR_MOVEMENT_BEARING_KMH = 3;

interface AcceptedLocation {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number;
}

export function useNavigation() {
  const [navigationState, setNavigationState] =
    useState<NavigationState>('idle');
  const [destination, setDestination] = useState<DestinationInfo | null>(null);
  const [routes, setRoutes] = useState<RouteDetails[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0);
  const [isLoadingRoute, setIsLoadingRoute] = useState<boolean>(false);
  const [isRerouting, setIsRerouting] = useState<boolean>(false);
  const [travelMode, setTravelMode] = useState<TravelMode>('driving');

  const [navigationSteps, setNavigationSteps] = useState<NavigationStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [currentStep, setCurrentStep] = useState<NavigationStep | null>(null);
  const [distanceToStep, setDistanceToStep] = useState<string>('');

  const [remainingDistance, setRemainingDistance] = useState<number>(0);
  const [remainingDuration, setRemainingDuration] = useState<number>(0);
  const [distanceTraveled, setDistanceTraveled] = useState<number>(0);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [eta, setEta] = useState<string>('');

  const [currentBearing, setCurrentBearing] = useState<number>(0);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [currentRoad, setCurrentRoad] = useState<string>('');
  const [matchedLocation, setMatchedLocation] =
    useState<MatchedLocation | null>(null);
  const [nextInstruction, setNextInstruction] = useState<string>('');
  const [isMuted, setIsMuted] = useState<boolean>(
    voiceNavigationService.isMuted(),
  );

  const routeAbortRef = useRef<AbortController | null>(null);
  const lastRawLocationRef = useRef<AcceptedLocation | null>(null);
  const lastFilteredLocationRef = useRef<AcceptedLocation | null>(null);
  const lastCalcTimeRef = useRef<number>(0);
  const lastProgressTimestampRef = useRef<number>(0);
  const lastProgressDistanceRef = useRef<number>(0);
  const journeyDistanceTraveledRef = useRef<number>(0);
  const lastJourneyLocationRef = useRef<AcceptedLocation | null>(null);
  const currentBearingRef = useRef<number>(0);
  const currentSpeedRef = useRef<number>(0);
  const lastSegmentIndexRef = useRef<number>(0);
  const currentStepIndexRef = useRef<number>(0);
  const navigationStateRef = useRef<NavigationState>('idle');
  const activeRouteRef = useRef<RouteDetails | null>(null);
  const locationSequenceRef = useRef<number>(0);
  const destinationRequestSequenceRef = useRef<number>(0);
  const arrivalHandledRef = useRef<boolean>(false);
  const arrivalCandidateCountRef = useRef<number>(0);
  const travelModeRef = useRef<TravelMode>('driving');

  const activeRoute = useMemo(() => {
    return routes[selectedRouteIndex] || routes[0] || null;
  }, [routes, selectedRouteIndex]);

  const activeRouteMetrics = useMemo(
    () =>
      activeRoute ? buildRouteGeometryMetrics(activeRoute.coordinates) : null,
    [activeRoute],
  );

  const stepProgressDistances = useMemo(() => {
    if (
      !activeRoute ||
      !activeRouteMetrics ||
      activeRouteMetrics.totalDistance <= 0
    ) {
      return [];
    }
    const routeScale =
      activeRoute.distanceMeters / activeRouteMetrics.totalDistance;
    return activeRoute.steps.map(step => {
      if (!step.location) return Number.NaN;
      const projection = findClosestPointOnRoute(
        step.location[1],
        step.location[0],
        activeRoute.coordinates,
        activeRouteMetrics,
      );
      return projection.distanceAlongRoute * routeScale;
    });
  }, [activeRoute, activeRouteMetrics]);

  useEffect(() => {
    navigationStateRef.current = navigationState;
  }, [navigationState]);

  useEffect(() => {
    activeRouteRef.current = activeRoute;
  }, [activeRoute]);

  const fetchRoute = useCallback(
    async (
      originLat: number,
      originLng: number,
      dest: DestinationInfo,
      showFailureAlert = true,
    ): Promise<RouteDetails[] | null> => {
      if (routeAbortRef.current) {
        routeAbortRef.current.abort();
      }
      const controller = new AbortController();
      routeAbortRef.current = controller;

      setIsLoadingRoute(true);

      let routeAlternatives: RouteDetails[];
      let routeFailure: unknown = null;
      try {
        routeAlternatives = await getRouteAlternatives(
          originLat,
          originLng,
          dest.latitude,
          dest.longitude,
          controller.signal,
        );
      } catch (error) {
        logger.warn('NavigationEngine', 'Route calculation failed:', error);
        routeFailure = error;
        routeAlternatives = [];
      } finally {
        if (routeAbortRef.current === controller) {
          routeAbortRef.current = null;
          setIsLoadingRoute(false);
        }
      }

      if (controller.signal.aborted) return null;

      if (routeAlternatives.length === 0) {
        if (showFailureAlert) {
          const offlineFailureMessage =
            routeFailure instanceof OfflineCoverageError ||
            routeFailure instanceof OfflineRoutingUnavailableError
              ? routeFailure.message
              : null;
          Alert.alert(
            offlineFailureMessage
              ? 'Offline Navigation Unavailable'
              : routeFailure
              ? 'Routing Unavailable'
              : 'Route Not Found',
            offlineFailureMessage
              ? offlineFailureMessage
              : routeFailure
              ? 'The routing service is unavailable. Check your connection and try again.'
              : 'Unable to calculate a valid driving route to this destination.',
          );
        }
        return null;
      }

      const modeRoutes = applyTravelModeToRoutes(
        routeAlternatives,
        travelModeRef.current,
      );
      setRoutes(modeRoutes);
      setSelectedRouteIndex(0);
      navigationStore.setRoutes(modeRoutes, 0);

      const primary = modeRoutes[0];
      setRemainingDistance(primary.distanceMeters);
      setRemainingDuration(primary.durationSeconds);
      if (showFailureAlert) {
        journeyDistanceTraveledRef.current = 0;
      }
      setDistanceTraveled(journeyDistanceTraveledRef.current);
      setProgressPct(0);
      setNavigationSteps(primary.steps);
      setCurrentStepIndex(0);
      currentStepIndexRef.current = 0;
      lastSegmentIndexRef.current = 0;
      lastProgressDistanceRef.current = 0;
      lastProgressTimestampRef.current = 0;
      arrivalHandledRef.current = false;
      arrivalCandidateCountRef.current = 0;
      mapMatchingService.reset();

      const initialEta = calculateDynamicETA(
        primary.distanceMeters,
        0,
        primary.distanceMeters,
        primary.durationSeconds,
        travelModeRef.current,
      );
      setEta(initialEta.etaString);

      const firstStep = primary.steps[0] || null;
      setCurrentStep(firstStep);
      setDistanceToStep(firstStep?.formattedDistance ?? '0 m');

      const firstInstruction =
        firstStep?.instruction || 'Follow highlighted route';
      setNextInstruction(firstInstruction);
      navigationStore.updateProgress(
        primary.distanceMeters,
        primary.durationSeconds,
        firstStep,
        0,
        currentBearingRef.current,
        Math.round(journeyDistanceTraveledRef.current),
        0,
        initialEta.etaString,
      );

      return modeRoutes;
    },
    [],
  );

  const selectDestination = useCallback(
    async (originLat: number, originLng: number, dest: DestinationInfo) => {
      const requestSequence = ++destinationRequestSequenceRef.current;
      navigationStateRef.current = 'idle';
      setNavigationState('idle');
      setDestination(dest);
      setRoutes([]);
      setSelectedRouteIndex(0);
      setNavigationSteps([]);
      setCurrentStep(null);
      setCurrentStepIndex(0);
      setMatchedLocation(null);
      navigationStore.reset();
      reroutingService.reset();
      mapMatchingService.reset();

      const altRoutes = await fetchRoute(originLat, originLng, dest);
      if (requestSequence !== destinationRequestSequenceRef.current) {
        return;
      }
      if (altRoutes && altRoutes.length > 0) {
        navigationStateRef.current = 'route_ready';
        setNavigationState('route_ready');
        navigationStore.setNavigationState('route_selection');
      } else {
        navigationStateRef.current = 'idle';
        setNavigationState('idle');
        setDestination(null);
        setRoutes([]);
        setNavigationSteps([]);
        setCurrentStep(null);
        setRemainingDistance(0);
        setRemainingDuration(0);
        setDistanceTraveled(0);
        setProgressPct(0);
        setEta('');
        setNextInstruction('');
        setDistanceToStep('');
        navigationStore.reset();
      }
    },
    [fetchRoute],
  );

  const selectRouteIndex = useCallback((index: number) => {
    setSelectedRouteIndex(index);
    navigationStore.setSelectedRouteIndex(index);
    lastSegmentIndexRef.current = 0;
    lastProgressDistanceRef.current = 0;
    lastProgressTimestampRef.current = 0;
    currentStepIndexRef.current = 0;
    journeyDistanceTraveledRef.current = 0;
    lastJourneyLocationRef.current = null;
    mapMatchingService.reset();
  }, []);

  const selectTravelMode = useCallback((mode: TravelMode) => {
    if (
      navigationStateRef.current === 'navigating' ||
      travelModeRef.current === mode
    ) {
      return;
    }
    travelModeRef.current = mode;
    setTravelMode(mode);
    setSelectedRouteIndex(0);
    setRoutes(currentRoutes => {
      const nextRoutes = applyTravelModeToRoutes(currentRoutes, mode);
      navigationStore.setRoutes(nextRoutes, 0);
      return nextRoutes;
    });
    lastSegmentIndexRef.current = 0;
    lastProgressDistanceRef.current = 0;
    lastProgressTimestampRef.current = 0;
    currentStepIndexRef.current = 0;
    journeyDistanceTraveledRef.current = 0;
    lastJourneyLocationRef.current = null;
    mapMatchingService.reset();
  }, []);

  useEffect(() => {
    if (activeRoute) {
      setRemainingDistance(activeRoute.distanceMeters);
      setRemainingDuration(activeRoute.durationSeconds);
      setDistanceTraveled(
        navigationStateRef.current === 'navigating'
          ? journeyDistanceTraveledRef.current
          : 0,
      );
      setProgressPct(0);
      setNavigationSteps(activeRoute.steps);
      setCurrentStepIndex(0);
      currentStepIndexRef.current = 0;
      lastSegmentIndexRef.current = 0;
      lastProgressDistanceRef.current = 0;
      lastProgressTimestampRef.current = 0;
      arrivalHandledRef.current = false;
      arrivalCandidateCountRef.current = 0;
      const initialEta = calculateDynamicETA(
        activeRoute.distanceMeters,
        0,
        activeRoute.distanceMeters,
        activeRoute.durationSeconds,
        travelModeRef.current,
      );
      setEta(initialEta.etaString);
      const firstStep = activeRoute.steps[0] || null;
      setCurrentStep(firstStep);
      setDistanceToStep(firstStep?.formattedDistance ?? '0 m');
      setNextInstruction(firstStep?.instruction || 'Follow highlighted route');
    }
  }, [activeRoute]);

  const startNavigation = useCallback(async () => {
    if (!destination || !activeRoute || navigationState === 'navigating')
      return;

    if (!connectivityService.isOnlineMode()) {
      try {
        await offlineMapManager.initialize();
        const firstRouteCoordinate = activeRoute.coordinates[0];
        const origin = lastFilteredLocationRef.current ?? {
          latitude: firstRouteCoordinate[1],
          longitude: firstRouteCoordinate[0],
          timestamp: Date.now(),
          accuracy: 10,
        };
        offlineMapManager.assertNavigationCoverage(
          {
            latitude: origin.latitude,
            longitude: origin.longitude,
          },
          {
            latitude: destination.latitude,
            longitude: destination.longitude,
          },
          activeRoute.coordinates,
        );
        logger.info(
          'OfflineRouting',
          'Offline navigation coverage validation passed.',
          {
            destination: {
              latitude: destination.latitude,
              longitude: destination.longitude,
            },
          },
        );
      } catch (error) {
        const message =
          error instanceof OfflineCoverageError
            ? error.message
            : 'Offline map coverage could not be verified. Reconnect or open Offline Maps and try again.';
        logger.warn(
          'OfflineRouting',
          'Offline navigation coverage validation failed.',
          error,
        );
        Alert.alert('Offline Navigation Unavailable', message);
        return;
      }
    }

    navigationStateRef.current = 'navigating';
    arrivalHandledRef.current = false;
    arrivalCandidateCountRef.current = 0;
    journeyDistanceTraveledRef.current = 0;
    lastJourneyLocationRef.current = lastFilteredLocationRef.current;
    setDistanceTraveled(0);
    setNavigationState('navigating');
    navigationStore.setNavigationState('navigating');

    voiceNavigationService.startSession(destination.title);
  }, [activeRoute, destination, navigationState]);

  const clearNavigationState = useCallback((endVoiceSession = true) => {
    destinationRequestSequenceRef.current += 1;
    if (routeAbortRef.current) {
      routeAbortRef.current.abort();
      routeAbortRef.current = null;
    }
    navigationStateRef.current = 'idle';
    setNavigationState('idle');
    setDestination(null);
    setRoutes([]);
    setSelectedRouteIndex(0);
    setNavigationSteps([]);
    setCurrentStep(null);
    setCurrentStepIndex(0);
    setRemainingDistance(0);
    setRemainingDuration(0);
    setDistanceTraveled(0);
    setProgressPct(0);
    setEta('');
    setNextInstruction('');
    setDistanceToStep('');
    setMatchedLocation(null);
    setCurrentSpeed(0);
    setCurrentRoad('');
    setIsRerouting(false);
    setIsLoadingRoute(false);
    lastSegmentIndexRef.current = 0;
    currentStepIndexRef.current = 0;
    lastProgressDistanceRef.current = 0;
    lastProgressTimestampRef.current = 0;
    journeyDistanceTraveledRef.current = 0;
    lastJourneyLocationRef.current = null;
    lastCalcTimeRef.current = 0;
    lastRawLocationRef.current = null;
    lastFilteredLocationRef.current = null;
    currentSpeedRef.current = 0;
    reroutingService.reset();
    mapMatchingService.reset();
    if (endVoiceSession) {
      voiceNavigationService.endSession();
    }
    navigationStore.reset();
  }, []);

  const cancelNavigation = useCallback(() => {
    arrivalHandledRef.current = false;
    arrivalCandidateCountRef.current = 0;
    clearNavigationState(true);
  }, [clearNavigationState]);

  const toggleVoiceMute = useCallback(() => {
    const muted = voiceNavigationService.toggleMute();
    setIsMuted(muted);
    navigationStore.setMuted(muted);
  }, []);

  const handleLocationUpdate = useCallback(
    async (
      userLat: number,
      userLng: number,
      userHeading?: number | null,
      userAccuracy = 10,
      userSpeedMetersPerSecond?: number | null,
      userTimestampMs?: number,
    ) => {
      const processingNow = Date.now();
      const fixTimestamp =
        typeof userTimestampMs === 'number' &&
        Number.isFinite(userTimestampMs) &&
        userTimestampMs > 0 &&
        userTimestampMs < processingNow + 60000
          ? userTimestampMs
          : processingNow;
      const validCoordinates =
        Number.isFinite(userLat) &&
        userLat >= -90 &&
        userLat <= 90 &&
        Number.isFinite(userLng) &&
        userLng >= -180 &&
        userLng <= 180;
      const validAccuracy =
        Number.isFinite(userAccuracy) &&
        userAccuracy > 0 &&
        userAccuracy <= LOCATION_CONFIG.GPS_ACCURACY_MAX_THRESHOLD_METERS;

      if (!validCoordinates || !validAccuracy) {
        logger.warn(
          'NavigationEngine',
          `Ignored GPS fix [${userLat}, ${userLng}] with accuracy ${userAccuracy}m`,
        );
        return;
      }

      const previousRawLocation = lastRawLocationRef.current;
      if (
        previousRawLocation &&
        fixTimestamp <= previousRawLocation.timestamp
      ) {
        return;
      }

      if (
        previousRawLocation &&
        isGPSJump(
          previousRawLocation.latitude,
          previousRawLocation.longitude,
          previousRawLocation.timestamp,
          userLat,
          userLng,
          fixTimestamp,
          LOCATION_CONFIG.GPS_MAX_PLAUSIBLE_SPEED_MPS,
        )
      ) {
        logger.warn(
          'NavigationEngine',
          `Ignored sudden GPS jump [${userLat.toFixed(5)}, ${userLng.toFixed(
            5,
          )}], accuracy ${userAccuracy}m`,
        );
        return;
      }

      let measuredSpeedKmH = 0;
      let rawDistanceDelta = 0;
      if (previousRawLocation) {
        rawDistanceDelta = getHaversineDistance(
          previousRawLocation.latitude,
          previousRawLocation.longitude,
          userLat,
          userLng,
        );
        const elapsedSeconds = Math.max(
          0.1,
          (fixTimestamp - previousRawLocation.timestamp) / 1000,
        );
        const minimumReliableMovement = Math.max(
          2,
          Math.min(
            12,
            ((previousRawLocation.accuracy + userAccuracy) / 2) * 0.35,
          ),
        );
        measuredSpeedKmH =
          rawDistanceDelta >= minimumReliableMovement
            ? calculateSpeed(rawDistanceDelta, elapsedSeconds)
            : 0;
      }
      if (
        typeof userSpeedMetersPerSecond === 'number' &&
        Number.isFinite(userSpeedMetersPerSecond) &&
        userSpeedMetersPerSecond >= 0 &&
        userSpeedMetersPerSecond <= LOCATION_CONFIG.GPS_MAX_PLAUSIBLE_SPEED_MPS
      ) {
        measuredSpeedKmH = userSpeedMetersPerSecond * 3.6;
      }

      const smoothedSpeed =
        currentSpeedRef.current <= 0
          ? measuredSpeedKmH
          : currentSpeedRef.current * 0.35 + measuredSpeedKmH * 0.65;
      currentSpeedRef.current = Math.max(0, Number(smoothedSpeed.toFixed(1)));
      setCurrentSpeed(currentSpeedRef.current);

      const previousFilteredLocation = lastFilteredLocationRef.current;
      let filteredLatitude = userLat;
      let filteredLongitude = userLng;
      if (
        previousFilteredLocation &&
        fixTimestamp - previousFilteredLocation.timestamp < 10000
      ) {
        const smoothingAlpha =
          userAccuracy <= 8 ? 0.8 : userAccuracy <= 18 ? 0.65 : 0.5;
        filteredLatitude =
          previousFilteredLocation.latitude +
          (userLat - previousFilteredLocation.latitude) * smoothingAlpha;
        filteredLongitude =
          previousFilteredLocation.longitude +
          (userLng - previousFilteredLocation.longitude) * smoothingAlpha;
      }

      let calculatedBearing = currentBearingRef.current;
      if (
        typeof userHeading === 'number' &&
        Number.isFinite(userHeading) &&
        userHeading >= 0
      ) {
        calculatedBearing = smoothBearing(
          currentBearingRef.current,
          userHeading % 360,
          0.3,
        );
      } else if (
        previousFilteredLocation &&
        rawDistanceDelta >= 2 &&
        currentSpeedRef.current >= MIN_SPEED_FOR_MOVEMENT_BEARING_KMH
      ) {
        const movementBearing = calculateBearing(
          previousFilteredLocation.latitude,
          previousFilteredLocation.longitude,
          filteredLatitude,
          filteredLongitude,
        );
        calculatedBearing = smoothBearing(
          currentBearingRef.current,
          movementBearing,
          0.3,
        );
      }
      currentBearingRef.current = calculatedBearing;
      setCurrentBearing(calculatedBearing);

      lastRawLocationRef.current = {
        latitude: userLat,
        longitude: userLng,
        timestamp: fixTimestamp,
        accuracy: userAccuracy,
      };
      lastFilteredLocationRef.current = {
        latitude: filteredLatitude,
        longitude: filteredLongitude,
        timestamp: fixTimestamp,
        accuracy: userAccuracy,
      };

      if (
        navigationStateRef.current !== 'navigating' ||
        !destination ||
        !activeRoute ||
        !activeRouteMetrics
      ) {
        return;
      }

      if (lastJourneyLocationRef.current) {
        const journeyDelta = getHaversineDistance(
          lastJourneyLocationRef.current.latitude,
          lastJourneyLocationRef.current.longitude,
          filteredLatitude,
          filteredLongitude,
        );
        const noiseFloorMeters = Math.max(3, Math.min(15, userAccuracy * 0.5));
        if (journeyDelta >= noiseFloorMeters) {
          journeyDistanceTraveledRef.current += journeyDelta;
          setDistanceTraveled(Math.round(journeyDistanceTraveledRef.current));
        }
      }
      lastJourneyLocationRef.current = {
        latitude: filteredLatitude,
        longitude: filteredLongitude,
        timestamp: fixTimestamp,
        accuracy: userAccuracy,
      };

      if (
        processingNow - lastCalcTimeRef.current <
        LOCATION_CONFIG.NAVIGATION_CALCULATION_THROTTLE_MS
      ) {
        return;
      }
      lastCalcTimeRef.current = processingNow;
      const updateSequence = ++locationSequenceRef.current;
      const routeAtStart = activeRoute;

      const matched = await mapMatchingService.snapToRoute(
        filteredLatitude,
        filteredLongitude,
        routeAtStart.coordinates,
        routeAtStart.steps,
        lastSegmentIndexRef.current,
        fixTimestamp,
      );

      if (
        updateSequence !== locationSequenceRef.current ||
        activeRouteRef.current !== routeAtStart ||
        navigationStateRef.current !== 'navigating'
      ) {
        return;
      }

      if (typeof matched.segmentIndex === 'number') {
        lastSegmentIndexRef.current = Math.max(
          lastSegmentIndexRef.current,
          matched.segmentIndex,
        );
      }

      setMatchedLocation(matched);
      navigationStore.updateLocationTelemetry(matched, currentSpeedRef.current);

      if (matched.roadName) {
        setCurrentRoad(matched.roadName);
      }

      const activeUserLat =
        matched.confidence > 0.4 ? matched.latitude : filteredLatitude;
      const activeUserLng =
        matched.confidence > 0.4 ? matched.longitude : filteredLongitude;
      const distanceToDestination = getHaversineDistance(
        userLat,
        userLng,
        destination.latitude,
        destination.longitude,
      );

      const arrivalRadiusMeters = Math.max(
        12,
        Math.min(LOCATION_CONFIG.ARRIVAL_THRESHOLD_METERS, userAccuracy * 1.2),
      );
      const routeProgressBeforeFix =
        routeAtStart.distanceMeters > 0
          ? lastProgressDistanceRef.current / routeAtStart.distanceMeters
          : 0;
      const isPlausibleArrival =
        distanceToDestination <= arrivalRadiusMeters &&
        (routeProgressBeforeFix >= 0.85 ||
          routeAtStart.distanceMeters <= arrivalRadiusMeters * 2);
      arrivalCandidateCountRef.current = isPlausibleArrival
        ? arrivalCandidateCountRef.current + 1
        : 0;

      if (arrivalCandidateCountRef.current >= 2 && !arrivalHandledRef.current) {
        arrivalHandledRef.current = true;
        const arrivalProgress = Math.min(
          100,
          (lastProgressDistanceRef.current / routeAtStart.distanceMeters) * 100,
        );
        logger.info(
          'NavigationEngine',
          `[GPS: ${userLat.toFixed(5)}, ${userLng.toFixed(
            5,
          )}] Acc: ${userAccuracy.toFixed(
            1,
          )}m | Progress: ${arrivalProgress.toFixed(
            1,
          )}% | RemDist: 0m | RemDur: 0s | ETA: now | OffRoute: false | Arrived: true`,
        );
        navigationStateRef.current = 'arrived';
        setNavigationState('arrived');
        navigationStore.setNavigationState('arrived');
        navigationStore.setArrivalDetected(true);
        setRemainingDistance(0);
        setRemainingDuration(0);
        setProgressPct(100);
        setEta('Now');
        navigationStore.updateProgress(
          0,
          0,
          routeAtStart.steps[routeAtStart.steps.length - 1] || null,
          Math.max(0, routeAtStart.steps.length - 1),
          calculatedBearing,
          Math.round(journeyDistanceTraveledRef.current),
          100,
          'Now',
        );
        voiceNavigationService.stop();
        voiceNavigationService.speak(
          'You have arrived at your destination!',
          true,
        );
        let didFinishArrival = false;
        const finishArrival = () => {
          if (didFinishArrival) return;
          didFinishArrival = true;
          voiceNavigationService.endSession();
          clearNavigationState(false);
        };
        Alert.alert(
          'You Have Arrived',
          `You reached ${destination.title}`,
          [{ text: 'Done', onPress: finishArrival }],
          { cancelable: true, onDismiss: finishArrival },
        );
        return;
      }

      const deviationResult = reroutingService.checkDeviation(
        filteredLatitude,
        filteredLongitude,
        routeAtStart.coordinates,
        matched.distanceToRoute,
        fixTimestamp,
        userAccuracy,
      );

      if (deviationResult.shouldRecalculate) {
        logger.info(
          'NavigationEngine',
          `[GPS: ${userLat.toFixed(5)}, ${userLng.toFixed(
            5,
          )}] Acc: ${userAccuracy.toFixed(1)}m | Progress: ${(
            (lastProgressDistanceRef.current / routeAtStart.distanceMeters) *
            100
          ).toFixed(1)}% | RemDist: ${Math.round(
            routeAtStart.distanceMeters - lastProgressDistanceRef.current,
          )}m | RemDur: pending | ETA: recalculating | OffRoute: true (${Math.round(
            deviationResult.distanceToRoute,
          )}m) | Arrived: false`,
        );
        reroutingService.markRerouteStarted();
        setIsRerouting(true);
        navigationStore.setIsRerouting(true);
        setNextInstruction('Recalculating route...');
        voiceNavigationService.speak('Recalculating route...', true);

        try {
          const newRoutes = await fetchRoute(
            filteredLatitude,
            filteredLongitude,
            destination,
            false,
          );
          if (!newRoutes || newRoutes.length === 0) {
            logger.warn(
              'NavigationEngine',
              '[ReroutingService] Recalculation yielded no valid route',
            );
          }
        } finally {
          reroutingService.markRerouteCompleted();
          setIsRerouting(false);
          navigationStore.setIsRerouting(false);
        }
        return;
      }

      const elapsedSinceProgressSeconds =
        lastProgressTimestampRef.current > 0
          ? Math.max(
              0.5,
              (fixTimestamp - lastProgressTimestampRef.current) / 1000,
            )
          : 1;
      const routeSpeedMetersPerSecond =
        routeAtStart.distanceMeters / routeAtStart.durationSeconds;
      const plausibleAdvanceMeters = Math.max(
        20,
        Math.max(routeSpeedMetersPerSecond, currentSpeedRef.current / 3.6) *
          elapsedSinceProgressSeconds *
          2 +
          userAccuracy,
      );
      const progress = calculateRouteProgress(
        activeUserLat,
        activeUserLng,
        routeAtStart.coordinates,
        {
          lastSegmentIndex: lastSegmentIndexRef.current,
          routeDistanceMeters: routeAtStart.distanceMeters,
          minimumDistanceTraveled: lastProgressDistanceRef.current,
          maximumDistanceTraveled:
            lastProgressDistanceRef.current + plausibleAdvanceMeters,
          metrics: activeRouteMetrics,
        },
      );

      lastProgressDistanceRef.current = progress.distanceTraveled;
      lastProgressTimestampRef.current = fixTimestamp;
      lastSegmentIndexRef.current = Math.max(
        lastSegmentIndexRef.current,
        progress.nearestSegmentIndex,
      );
      setDistanceTraveled(Math.round(journeyDistanceTraveledRef.current));
      setRemainingDistance(progress.remainingDistance);
      setProgressPct(progress.progressPct);

      const dynamicEta = calculateDynamicETA(
        progress.remainingDistance,
        currentSpeedRef.current,
        routeAtStart.distanceMeters,
        routeAtStart.durationSeconds,
        travelModeRef.current,
      );
      setRemainingDuration(dynamicEta.remainingDurationSeconds);
      setEta(dynamicEta.etaString);

      let activeStepIndex = currentStepIndexRef.current;
      while (activeStepIndex < routeAtStart.steps.length - 1) {
        const maneuverProgress = stepProgressDistances[activeStepIndex];
        if (
          Number.isFinite(maneuverProgress) &&
          progress.distanceTraveled + STEP_COMPLETION_THRESHOLD_METERS >=
            maneuverProgress
        ) {
          activeStepIndex += 1;
        } else {
          break;
        }
      }

      const didAdvanceStep = activeStepIndex !== currentStepIndexRef.current;
      currentStepIndexRef.current = activeStepIndex;
      const activeStep = routeAtStart.steps[activeStepIndex] || null;
      if (didAdvanceStep) {
        setCurrentStepIndex(activeStepIndex);
        setCurrentStep(activeStep);
        setNextInstruction(
          activeStep?.instruction || 'Follow highlighted route',
        );
        if (activeStep) {
          voiceNavigationService.speak(activeStep.instruction, true);
        }
      }

      if (activeStep) {
        const maneuverProgress = stepProgressDistances[activeStepIndex];
        const distanceToManeuver = Number.isFinite(maneuverProgress)
          ? Math.max(0, maneuverProgress - progress.distanceTraveled)
          : activeStep.location
          ? getHaversineDistance(
              activeUserLat,
              activeUserLng,
              activeStep.location[1],
              activeStep.location[0],
            )
          : progress.remainingDistance;
        setDistanceToStep(formatDistance(distanceToManeuver));
        voiceNavigationService.speakManeuverPrompt(
          activeStep.instruction,
          distanceToManeuver,
        );
      }

      navigationStore.updateProgress(
        progress.remainingDistance,
        dynamicEta.remainingDurationSeconds,
        activeStep,
        activeStepIndex,
        calculatedBearing,
        Math.round(journeyDistanceTraveledRef.current),
        progress.progressPct,
        dynamicEta.etaString,
      );

      logger.info(
        'NavigationEngine',
        `[GPS: ${userLat.toFixed(5)}, ${userLng.toFixed(
          5,
        )}] Acc: ${userAccuracy.toFixed(
          1,
        )}m | Progress: ${progress.progressPct.toFixed(
          1,
        )}% | Traveled: ${Math.round(
          journeyDistanceTraveledRef.current,
        )}m | RemDist: ${progress.remainingDistance}m | RemDur: ${
          dynamicEta.remainingDurationSeconds
        }s | ETA: ${dynamicEta.etaString} | OffRoute: ${
          deviationResult.isOffRoute
        } (${Math.round(deviationResult.distanceToRoute)}m) | Arrived: false`,
      );
    },
    [
      activeRoute,
      activeRouteMetrics,
      clearNavigationState,
      destination,
      fetchRoute,
      stepProgressDistances,
    ],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        reroutingService.resetDeviationTracking();
        mapMatchingService.reset();
      }
    });

    return () => {
      subscription.remove();
      if (routeAbortRef.current) {
        routeAbortRef.current.abort();
        routeAbortRef.current = null;
      }
      voiceNavigationService.endSession();
    };
  }, []);

  const formattedRemainingDistance = useMemo(
    () => formatDistance(remainingDistance),
    [remainingDistance],
  );

  const formattedRemainingDuration = useMemo(
    () => formatDuration(remainingDuration),
    [remainingDuration],
  );

  return {
    navigationState,
    destination,
    routes,
    selectedRouteIndex,
    routeDetails: activeRoute,
    isLoadingRoute,
    isRerouting,
    travelMode,
    navigationSteps,
    currentStepIndex,
    currentStep,
    distanceToStep,
    remainingDistance,
    remainingDuration,
    distanceTraveled,
    progressPct,
    eta,
    formattedRemainingDistance,
    formattedRemainingDuration,
    currentBearing,
    currentSpeed,
    currentRoad,
    matchedLocation,
    nextInstruction,
    isMuted,
    selectDestination,
    selectRouteIndex,
    selectTravelMode,
    startNavigation,
    cancelNavigation,
    toggleVoiceMute,
    handleLocationUpdate,
  };
}
