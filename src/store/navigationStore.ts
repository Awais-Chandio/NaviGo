import { SearchResult } from '../services/searchService';
import { RouteDetails, NavigationStep } from '../services/routingService';
import { MatchedLocation } from '../services/MapMatchingService';
import { logger } from '../utils/logger';

export type NavigationModeState =
  | 'idle'
  | 'route_selection'
  | 'navigating'
  | 'arrived'
  | 'cancelled';

export interface NavigationStoreData {
  navigationState: NavigationModeState;
  destination: SearchResult | null;
  routes: RouteDetails[];
  selectedRouteIndex: number;
  currentStep: NavigationStep | null;
  currentStepIndex: number;
  remainingDistance: number;
  remainingDuration: number;
  distanceTraveled: number;
  progressPct: number;
  eta: string;
  currentBearing: number;
  isMuted: boolean;
  isRerouting: boolean;
  matchedLocation: MatchedLocation | null;
  currentSpeed: number;
  currentRoad: string;
  arrivalDetected: boolean;
  trafficEnabled: boolean;
}

type Listener = (state: NavigationStoreData) => void;

class NavigationStore {
  private state: NavigationStoreData = {
    navigationState: 'idle',
    destination: null,
    routes: [],
    selectedRouteIndex: 0,
    currentStep: null,
    currentStepIndex: 0,
    remainingDistance: 0,
    remainingDuration: 0,
    distanceTraveled: 0,
    progressPct: 0,
    eta: '',
    currentBearing: 0,
    isMuted: false,
    isRerouting: false,
    matchedLocation: null,
    currentSpeed: 0,
    currentRoad: '',
    arrivalDetected: false,
    trafficEnabled: true,
  };

  private listeners: Set<Listener> = new Set();

  public getState(): NavigationStoreData {
    return {
      ...this.state,
      destination: this.state.destination
        ? { ...this.state.destination }
        : null,
      routes: [...this.state.routes],
      currentStep: this.state.currentStep
        ? { ...this.state.currentStep }
        : null,
      matchedLocation: this.state.matchedLocation
        ? { ...this.state.matchedLocation }
        : null,
    };
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const copy = this.getState();
    this.listeners.forEach(listener => {
      try {
        listener(copy);
      } catch (error) {
        logger.warn('NavigationStore', 'State listener failed.', error);
      }
    });
  }

  public setNavigationState(mode: NavigationModeState) {
    this.state.navigationState = mode;
    if (mode === 'arrived') {
      this.state.arrivalDetected = true;
    }
    this.notify();
  }

  public setDestination(dest: SearchResult | null) {
    this.state.destination = dest;
    this.notify();
  }

  public setRoutes(routes: RouteDetails[], selectedIndex: number = 0) {
    this.state.routes = routes;
    this.state.selectedRouteIndex = selectedIndex;
    if (routes.length > 0 && routes[selectedIndex]) {
      const active = routes[selectedIndex];
      this.state.remainingDistance = active.distanceMeters;
      this.state.remainingDuration = active.durationSeconds;
      this.state.distanceTraveled = 0;
      this.state.progressPct = 0;
      this.state.currentStep = active.steps[0] || null;
      this.state.currentStepIndex = 0;
    }
    this.notify();
  }

  public setSelectedRouteIndex(index: number) {
    if (index >= 0 && index < this.state.routes.length) {
      this.state.selectedRouteIndex = index;
      const active = this.state.routes[index];
      this.state.remainingDistance = active.distanceMeters;
      this.state.remainingDuration = active.durationSeconds;
      this.state.distanceTraveled = 0;
      this.state.progressPct = 0;
      this.state.currentStep = active.steps[0] || null;
      this.state.currentStepIndex = 0;
      this.notify();
    }
  }

  public updateProgress(
    remainingDistMeters: number,
    remainingDurSeconds: number,
    currentStep: NavigationStep | null,
    stepIndex: number,
    bearing?: number,
    distanceTraveled?: number,
    progressPct?: number,
    eta?: string,
  ) {
    this.state.remainingDistance = remainingDistMeters;
    this.state.remainingDuration = remainingDurSeconds;
    this.state.currentStep = currentStep;
    this.state.currentStepIndex = stepIndex;
    if (typeof bearing === 'number') {
      this.state.currentBearing = bearing;
    }
    if (typeof distanceTraveled === 'number') {
      this.state.distanceTraveled = distanceTraveled;
    }
    if (typeof progressPct === 'number') {
      this.state.progressPct = progressPct;
    }
    if (typeof eta === 'string') {
      this.state.eta = eta;
    }
    this.notify();
  }

  public setIsRerouting(isRerouting: boolean) {
    if (this.state.isRerouting === isRerouting) return;
    this.state.isRerouting = isRerouting;
    this.notify();
  }

  public setMatchedLocation(matched: MatchedLocation | null) {
    this.state.matchedLocation = matched;
    if (matched?.roadName) {
      this.state.currentRoad = matched.roadName;
    }
    this.notify();
  }

  public setCurrentSpeed(speedKmH: number) {
    const nextSpeed = Math.max(0, speedKmH);
    if (Math.abs(this.state.currentSpeed - nextSpeed) < 0.1) return;
    this.state.currentSpeed = nextSpeed;
    this.notify();
  }

  public setCurrentRoad(road: string) {
    if (this.state.currentRoad === road) return;
    this.state.currentRoad = road;
    this.notify();
  }

  public updateLocationTelemetry(
    matched: MatchedLocation,
    speedKmH: number,
  ) {
    this.state.matchedLocation = matched;
    this.state.currentSpeed = Math.max(0, speedKmH);
    if (matched.roadName) {
      this.state.currentRoad = matched.roadName;
    }
    this.notify();
  }

  public setArrivalDetected(detected: boolean) {
    if (this.state.arrivalDetected === detected) return;
    this.state.arrivalDetected = detected;
    this.notify();
  }

  public setTrafficEnabled(enabled: boolean) {
    if (this.state.trafficEnabled === enabled) return;
    this.state.trafficEnabled = enabled;
    this.notify();
  }

  public setMuted(muted: boolean) {
    if (this.state.isMuted === muted) return;
    this.state.isMuted = muted;
    this.notify();
  }

  public reset() {
    this.state = {
      navigationState: 'idle',
      destination: null,
      routes: [],
      selectedRouteIndex: 0,
      currentStep: null,
      currentStepIndex: 0,
      remainingDistance: 0,
      remainingDuration: 0,
      distanceTraveled: 0,
      progressPct: 0,
      eta: '',
      currentBearing: 0,
      isMuted: false,
      isRerouting: false,
      matchedLocation: null,
      currentSpeed: 0,
      currentRoad: '',
      arrivalDetected: false,
      trafficEnabled: true,
    };
    this.notify();
  }
}

export const navigationStore = new NavigationStore();
export default navigationStore;
