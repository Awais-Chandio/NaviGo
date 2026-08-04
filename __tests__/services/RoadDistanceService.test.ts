import { RoadDistanceService } from '../../src/services/RoadDistanceService';

describe('RoadDistanceService', () => {
  it('returns OSRM road distances in the same order as destinations', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        code: 'Ok',
        distances: [[1250.4, null]],
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    try {
      const service = new RoadDistanceService();
      const distances = await service.getDrivingDistances(
        { latitude: 25.396, longitude: 68.3578 },
        [
          { latitude: 25.4, longitude: 68.36 },
          { latitude: 25.41, longitude: 68.37 },
        ],
      );

      expect(distances).toEqual([1250, null]);
      expect(fetchMock.mock.calls[0][0]).toContain('/table/v1/driving/');
      expect(fetchMock.mock.calls[0][0]).toContain('annotations=distance');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses the alternate OSRM endpoint when the primary endpoint fails', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('primary unavailable'))
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          code: 'Ok',
          distances: [[980.2]],
        }),
      } as unknown as Response);
    globalThis.fetch = fetchMock;

    try {
      const service = new RoadDistanceService();
      const distances = await service.getDrivingDistances(
        { latitude: 25.396, longitude: 68.3578 },
        [{ latitude: 25.4, longitude: 68.36 }],
      );

      expect(distances).toEqual([980]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toContain(
        'router.project-osrm.org/table/',
      );
      expect(fetchMock.mock.calls[1][0]).toContain(
        'routing.openstreetmap.de/routed-car/table/',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
