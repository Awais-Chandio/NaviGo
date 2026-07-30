import { ReroutingService } from '../../src/services/ReroutingService';

describe('ReroutingService', () => {
  let reroutingService: ReroutingService;

  const mockRouteCoordinates: [number, number][] = [
    [68.3578, 25.3960],
    [68.3590, 25.3970],
    [68.3610, 25.3990],
  ];

  beforeEach(() => {
    reroutingService = new ReroutingService(50, 2000); // 50m threshold, 2s cooldown
  });

  it('detects when user is on route', () => {
    const result = reroutingService.checkDeviation(
      25.3960,
      68.3578,
      mockRouteCoordinates,
    );

    expect(result.isOffRoute).toBe(false);
    expect(result.shouldRecalculate).toBe(false);
  });

  it('detects route deviation beyond threshold and enforces consecutive fix check', () => {
    const offRouteLat = 25.4050; // ~1km away
    const offRouteLng = 68.3700;
    const startTime = 1_000_000;

    // First fix triggers offRoute flag but waits for consecutive confirmation
    const firstCheck = reroutingService.checkDeviation(
      offRouteLat,
      offRouteLng,
      mockRouteCoordinates,
      undefined,
      startTime,
    );

    expect(firstCheck.isOffRoute).toBe(true);
    expect(firstCheck.shouldRecalculate).toBe(false);

    // Second check still waiting for 3rd confirmation fix
    const secondCheck = reroutingService.checkDeviation(
      offRouteLat,
      offRouteLng,
      mockRouteCoordinates,
      undefined,
      startTime + 1500,
    );

    expect(secondCheck.isOffRoute).toBe(true);
    expect(secondCheck.shouldRecalculate).toBe(false);

    // Third consecutive fix triggers recalculation
    const thirdCheck = reroutingService.checkDeviation(
      offRouteLat,
      offRouteLng,
      mockRouteCoordinates,
      undefined,
      startTime + 3000,
    );

    expect(thirdCheck.isOffRoute).toBe(true);
    expect(thirdCheck.shouldRecalculate).toBe(true);
  });

  it('enforces cooldown timer to prevent rapid duplicate reroutes', () => {
    const offRouteLat = 25.4050;
    const offRouteLng = 68.3700;
    const startTime = Date.now();

    reroutingService.checkDeviation(
      offRouteLat,
      offRouteLng,
      mockRouteCoordinates,
      undefined,
      startTime,
    );
    reroutingService.checkDeviation(
      offRouteLat,
      offRouteLng,
      mockRouteCoordinates,
      undefined,
      startTime + 1500,
    );
    const triggerResult = reroutingService.checkDeviation(
      offRouteLat,
      offRouteLng,
      mockRouteCoordinates,
      undefined,
      startTime + 3000,
    );
    expect(triggerResult.shouldRecalculate).toBe(true);

    reroutingService.markRerouteStarted();

    // Immediate subsequent check during cooldown
    const cooldownResult = reroutingService.checkDeviation(
      offRouteLat,
      offRouteLng,
      mockRouteCoordinates,
      undefined,
      startTime + 3100,
    );
    expect(cooldownResult.shouldRecalculate).toBe(false);
    expect(cooldownResult.reason).toContain('Reroute already in progress');

    reroutingService.markRerouteCompleted();
  });
});
