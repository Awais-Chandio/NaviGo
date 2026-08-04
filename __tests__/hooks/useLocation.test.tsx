import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useLocation } from '../../src/hooks/useLocation';

jest.mock('../../src/services/searchService', () => ({
  reverseGeocodeDetails: jest.fn().mockResolvedValue({
    displayName: 'Test location',
    detectedArea: 'Test area',
    city: 'Test city',
    countryCode: 'PK',
  }),
}));

describe('useLocation', () => {
  it('keeps an accurate stationary fix usable without movement callbacks', async () => {
    jest.useFakeTimers();
    let latest: ReturnType<typeof useLocation> | undefined;
    let renderer: TestRenderer.ReactTestRenderer;

    function Harness() {
      latest = useLocation(false);
      return null;
    }

    await act(async () => {
      renderer = TestRenderer.create(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest?.hasLocationFix).toBe(true);

    // Android may suppress callbacks indefinitely while the device remains
    // within distanceFilter. A correct fix must not expire just for standing.
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(latest?.hasLocationFix).toBe(true);

    act(() => renderer.unmount());
    jest.useRealTimers();
  });
});
