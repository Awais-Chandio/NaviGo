import { trafficService, SimulatedTrafficProvider } from '../../src/services/TrafficService';

describe('TrafficService', () => {
  const mockRouteCoordinates: [number, number][] = [
    [68.3578, 25.3960],
    [68.3590, 25.3970],
    [68.3610, 25.3990],
    [68.3630, 25.4010],
  ];

  it('does not display fabricated traffic by default', async () => {
    const segments = await trafficService.fetchTrafficSegments(mockRouteCoordinates);

    expect(segments).toEqual([]);
  });

  it('allows setting custom traffic providers', async () => {
    const provider = new SimulatedTrafficProvider();
    trafficService.setProvider(provider);

    const segments = await trafficService.fetchTrafficSegments(mockRouteCoordinates);
    expect(segments.length).toBe(3);
  });
});
