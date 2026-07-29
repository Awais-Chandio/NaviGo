import { useState, useCallback, useRef, useMemo } from 'react';
import { Alert } from 'react-native';
import {
  getRouteDetails,
  type RouteDetails,
  type NavigationStep,
} from '../services/routingService';
import { voiceService } from '../services/voiceService';
import {
  calculateBearing,
  calculateRemainingDistanceOnRoute,
  getDistanceToRoute,
  getHaversineDistance,
  formatDistance,
  formatDuration,
} from '../utils/locationUtils';

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

const OFF_ROUTE_THRESHOLD_METERS = 40; // Reroute if >40m off route
const ARRIVAL_THRESHOLD_METERS = 20; // Arrived if <20m to destination
const STEP_COMPLETION_THRESHOLD_METERS = 25; // Transition to next step when within 25m of step maneuver location
const MIN_LOCATION_DELTA_METERS = 1.5; // Throttle math calculations for GPS updates under 1.5m jitter

export function useNavigation() {
  const [navigationState, setNavigationState] = useState<NavigationState>('idle');
  const [destination, setDestination] = useState<DestinationInfo | null>(null);
  const [routeDetails, setRouteDetails] = useState<RouteDetails | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState<boolean>(false);

  // Turn-by-Turn Steps state
  const [navigationSteps, setNavigationSteps] = useState<NavigationStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [currentStep, setCurrentStep] = useState<NavigationStep | null>(null);
  const [distanceToStep, setDistanceToStep] = useState<string>('');

  // Dynamic progress state
  const [remainingDistance, setRemainingDistance] = useState<number>(0);
  const [remainingDuration, setRemainingDuration] = useState<number>(0);
  const [currentBearing, setCurrentBearing] = useState<number>(0);
  const [nextInstruction, setNextInstruction] = useState<string>('');

  const routeAbortRef = useRef<AbortController | null>(null);
  const offRouteCountRef = useRef<number>(0);
  const lastLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastCalcTimeRef = useRef<number>(0);

  /**
   * Fetches driving route from user location to destination with turn steps.
   */
  const fetchRoute = useCallback(
    async (
      originLat: number,
      originLng: number,
      dest: DestinationInfo,
    ): Promise<RouteDetails | null> => {
      if (routeAbortRef.current) {
        routeAbortRef.current.abort();
      }
      const controller = new AbortController();
      routeAbortRef.current = controller;

      setIsLoadingRoute(true);

      const routeData = await getRouteDetails(
        originLat,
        originLng,
        dest.latitude,
        dest.longitude,
        controller.signal,
      );

      setIsLoadingRoute(false);

      if (!routeData || routeData.coordinates.length === 0) {
        Alert.alert(
          'Route Not Found',
          'Unable to calculate a driving route to this destination.',
        );
        return null;
      }

      setRouteDetails(routeData);
      setRemainingDistance(routeData.distanceMeters);
      setRemainingDuration(routeData.durationSeconds);
      setNavigationSteps(routeData.steps);
      setCurrentStepIndex(0);

      const firstStep = routeData.steps[0] || null;
      setCurrentStep(firstStep);
      setDistanceToStep(firstStep?.formattedDistance ?? '0 m');

      const firstInstruction =
        firstStep?.instruction || 'Follow highlighted route';
      setNextInstruction(firstInstruction);

      return routeData;
    },
    [],
  );

  /**
   * Sets a destination and transitions to 'route_ready'.
   */
  const selectDestination = useCallback(
    async (originLat: number, originLng: number, dest: DestinationInfo) => {
      setDestination(dest);
      offRouteCountRef.current = 0;

      const route = await fetchRoute(originLat, originLng, dest);
      if (route) {
        setNavigationState('route_ready');
      } else {
        setNavigationState('idle');
      }
    },
    [fetchRoute],
  );

  /**
   * Starts turn-by-turn navigation mode.
   */
  const startNavigation = useCallback(() => {
    if (!destination || !routeDetails) return;
    setNavigationState('navigating');

    const activeInstruction = currentStep?.instruction || `Navigating to ${destination.title}`;
    voiceService.speak(activeInstruction);
  }, [currentStep, destination, routeDetails]);

  /**
   * Cancels active navigation and resets state to 'idle'.
   */
  const cancelNavigation = useCallback(() => {
    setNavigationState('idle');
    setDestination(null);
    setRouteDetails(null);
    setNavigationSteps([]);
    setCurrentStep(null);
    setCurrentStepIndex(0);
    setRemainingDistance(0);
    setRemainingDuration(0);
    setNextInstruction('');
    setDistanceToStep('');
    offRouteCountRef.current = 0;
    voiceService.stop();
  }, []);

  /**
   * Location progress updates during live tracking.
   * Throttles jitter, updates bearing, progress metrics, step index progression, off-route rerouting, and arrival.
   */
  const handleLocationUpdate = useCallback(
    async (userLat: number, userLng: number, userHeading?: number | null) => {
      const now = Date.now();

      // Check distance delta from last location to skip minor GPS jitter (< 1.5m)
      if (lastLocationRef.current) {
        const deltaDist = getHaversineDistance(
          lastLocationRef.current.latitude,
          lastLocationRef.current.longitude,
          userLat,
          userLng,
        );

        // Throttle rapid sub-second calculations if position barely moved
        if (deltaDist < MIN_LOCATION_DELTA_METERS && now - lastCalcTimeRef.current < 1500) {
          return;
        }
      }

      lastCalcTimeRef.current = now;

      // Calculate bearing from previous position or GPS heading
      if (typeof userHeading === 'number' && userHeading >= 0) {
        setCurrentBearing(userHeading);
      } else if (lastLocationRef.current) {
        const brng = calculateBearing(
          lastLocationRef.current.latitude,
          lastLocationRef.current.longitude,
          userLat,
          userLng,
        );
        setCurrentBearing(brng);
      }
      lastLocationRef.current = { latitude: userLat, longitude: userLng };

      // Return early if not currently navigating or no destination active
      if (navigationState !== 'navigating' || !destination || !routeDetails) {
        return;
      }

      // 1. Arrival Detection (< 20 meters to destination)
      const distToDest = getHaversineDistance(
        userLat,
        userLng,
        destination.latitude,
        destination.longitude,
      );

      if (distToDest <= ARRIVAL_THRESHOLD_METERS) {
        setNavigationState('arrived');
        setNextInstruction('You have arrived.');
        voiceService.speak('You have arrived at your destination!');
        Alert.alert(
          'You have arrived',
          `You reached ${destination.title}`,
          [{ text: 'OK', onPress: () => cancelNavigation() }],
          { cancelable: false },
        );
        return;
      }

      // 2. Off-Route Detection (distance to route > 40m)
      const distToPolyline = getDistanceToRoute(
        userLat,
        userLng,
        routeDetails.coordinates,
      );

      if (distToPolyline > OFF_ROUTE_THRESHOLD_METERS) {
        offRouteCountRef.current += 1;
        if (offRouteCountRef.current >= 2) {
          console.log('[Off-Route Detected]: Recalculating route...');
          setNextInstruction('Recalculating route...');
          voiceService.speak('Recalculating route...');
          offRouteCountRef.current = 0;
          await fetchRoute(userLat, userLng, destination);
          return;
        }
      } else {
        offRouteCountRef.current = 0;
      }

      // 3. Dynamic Remaining Distance & Duration Calculation
      const remMeters = calculateRemainingDistanceOnRoute(
        userLat,
        userLng,
        routeDetails.coordinates,
      );

      setRemainingDistance(remMeters);

      // Estimate remaining duration (average speed ~30 km/h = 8.33 m/s)
      const estSeconds = Math.round(remMeters / 8.33);
      setRemainingDuration(estSeconds);

      // 4. Current Step Tracking & Automatic Instruction Transition
      if (navigationSteps.length > 0) {
        let activeIndex = currentStepIndex;
        const activeStep = navigationSteps[activeIndex];

        if (activeStep && activeStep.location) {
          const distToManeuver = getHaversineDistance(
            userLat,
            userLng,
            activeStep.location[1],
            activeStep.location[0],
          );

          setDistanceToStep(formatDistance(distToManeuver));

          // Transition to next step when user reaches maneuver location (< 25m)
          if (
            distToManeuver <= STEP_COMPLETION_THRESHOLD_METERS &&
            activeIndex < navigationSteps.length - 1
          ) {
            activeIndex += 1;
            setCurrentStepIndex(activeIndex);
            const nextStep = navigationSteps[activeIndex];
            setCurrentStep(nextStep);
            setNextInstruction(nextStep.instruction);
            voiceService.speak(nextStep.instruction);
          }
        } else {
          setDistanceToStep(formatDistance(remMeters));
        }
      }
    },
    [
      cancelNavigation,
      currentStepIndex,
      destination,
      fetchRoute,
      navigationState,
      navigationSteps,
      routeDetails,
    ],
  );

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
    routeDetails,
    isLoadingRoute,
    navigationSteps,
    currentStepIndex,
    currentStep,
    distanceToStep,
    remainingDistance,
    remainingDuration,
    formattedRemainingDistance,
    formattedRemainingDuration,
    currentBearing,
    nextInstruction,
    selectDestination,
    startNavigation,
    cancelNavigation,
    handleLocationUpdate,
  };
}
