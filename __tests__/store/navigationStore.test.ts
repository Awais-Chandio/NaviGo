import navigationStore from '../../src/store/navigationStore';

describe('navigationStore', () => {
  beforeEach(() => {
    navigationStore.reset();
  });

  it('updates navigationState and notifies subscribers', () => {
    let lastState = navigationStore.getState();
    const unsubscribe = navigationStore.subscribe(state => {
      lastState = state;
    });

    expect(lastState.navigationState).toBe('idle');

    navigationStore.setNavigationState('navigating');
    expect(lastState.navigationState).toBe('navigating');

    unsubscribe();
  });

  it('manages route alternatives and route selection', () => {
    const dummyRoutes: any = [
      { id: '1', distanceMeters: 1000, durationSeconds: 120, steps: [] },
      { id: '2', distanceMeters: 1200, durationSeconds: 150, steps: [] },
    ];

    navigationStore.setRoutes(dummyRoutes, 0);
    expect(navigationStore.getState().routes.length).toBe(2);
    expect(navigationStore.getState().selectedRouteIndex).toBe(0);

    navigationStore.setSelectedRouteIndex(1);
    expect(navigationStore.getState().selectedRouteIndex).toBe(1);
    expect(navigationStore.getState().remainingDistance).toBe(1200);
  });

  it('handles Phase 14 navigation intelligence state updates', () => {
    navigationStore.setIsRerouting(true);
    expect(navigationStore.getState().isRerouting).toBe(true);

    navigationStore.setCurrentSpeed(45);
    expect(navigationStore.getState().currentSpeed).toBe(45);

    navigationStore.setCurrentRoad('Main Street');
    expect(navigationStore.getState().currentRoad).toBe('Main Street');

    navigationStore.setMatchedLocation({
      latitude: 25.396,
      longitude: 68.3578,
      roadName: 'Main Street',
      confidence: 0.95,
    });
    expect(navigationStore.getState().matchedLocation?.confidence).toBe(0.95);

    navigationStore.setArrivalDetected(true);
    expect(navigationStore.getState().arrivalDetected).toBe(true);

    navigationStore.setTrafficEnabled(false);
    expect(navigationStore.getState().trafficEnabled).toBe(false);

    navigationStore.reset();
    expect(navigationStore.getState().isRerouting).toBe(false);
    expect(navigationStore.getState().currentSpeed).toBe(0);
    expect(navigationStore.getState().matchedLocation).toBeNull();
  });
});

