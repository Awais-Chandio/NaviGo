import { trafficService, SimulatedTrafficProvider } from '../../src/services/TrafficService';

describe('TrafficService', () => {
  const mockRouteCoordinates: [number, number][] = [
    [68.3578, 25.3960],
    [68.3590, 25.3970],
    [68.3610, 25.3990],
    [68.3630, 25.4010],
  ];

  it('generates traffic flow segments for route coordinates', async () => {
    const segments = await trafficService.fetchTrafficSegments(mockRouteCoordinates);

    expect(segments.length).toBe(mockRouteCoordinates.length - 1);
    expect(segments[0].color).toBeDefined();
    expect(segments[0].speed).toBeDefined();
    expect(segments[0].start).toEqual(mockRouteCoordinates[0]);
    expect(segments[0].end).toEqual(mockRouteCoordinates[1]);
  });

  it('allows setting custom traffic providers', async () => {
    const provider = new SimulatedTrafficProvider();
    trafficService.setProvider(provider);

    const segments = await trafficService.fetchTrafficSegments(mockRouteCoordinates);
    expect(segments.length).toBe(3);
  });
});
