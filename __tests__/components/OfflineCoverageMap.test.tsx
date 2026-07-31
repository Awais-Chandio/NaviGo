import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  GeoJSONSource,
  Layer,
  ViewAnnotation,
} from '@maplibre/maplibre-react-native';

import { OfflineCoverageMap } from '../../src/components/OfflineCoverageMap';
import { OfflineRegion } from '../../src/types/location';

function createRegion(
  id: string,
  latitude: number,
  longitude: number,
): OfflineRegion {
  return {
    id,
    name: `Region ${id}`,
    center: { latitude, longitude },
    radiusKm: 10,
    coverageAreaKm2: Math.PI * 100,
    bounds: {
      minLat: latitude - 0.1,
      maxLat: latitude + 0.1,
      minLng: longitude - 0.1,
      maxLng: longitude + 0.1,
    },
    minZoom: 10,
    maxZoom: 16,
    version: 2,
    status: 'completed',
    isDownloaded: true,
    sizeBytes: 100,
    estimatedTileCount: 10,
    downloadedTileCount: 10,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    downloadedAt: '2026-07-31T00:00:00.000Z',
    styleUrl: 'https://example.com/style.json',
  };
}

describe('OfflineCoverageMap', () => {
  it('keeps MapLibre native IDs stable when the selected region changes', () => {
    const firstRegion = createRegion('first', 25.38, 68.34);
    const secondRegion = createRegion('second', 25.48, 68.44);
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(
        <OfflineCoverageMap
          region={firstRegion}
          currentLocation={firstRegion.center}
        />,
      );
    });

    const firstSourceId = renderer!.root.findByType(GeoJSONSource).props.id;
    const firstSourceData = renderer!.root.findByType(GeoJSONSource).props.data;
    const firstLayerId = renderer!.root.findByType(Layer).props.id;
    const firstAnnotationId =
      renderer!.root.findByType(ViewAnnotation).props.id;

    act(() => {
      renderer!.update(
        <OfflineCoverageMap
          region={secondRegion}
          currentLocation={secondRegion.center}
        />,
      );
    });

    expect(renderer!.root.findByType(GeoJSONSource).props.id).toBe(
      firstSourceId,
    );
    expect(renderer!.root.findByType(Layer).props.id).toBe(firstLayerId);
    expect(renderer!.root.findByType(ViewAnnotation).props.id).toBe(
      firstAnnotationId,
    );
    expect(firstSourceData.properties.regionId).toBe(firstRegion.id);
    expect(
      renderer!.root.findByType(GeoJSONSource).props.data.properties.regionId,
    ).toBe(secondRegion.id);
    expect(firstSourceId).not.toContain(firstRegion.id);
    expect(firstSourceId).not.toContain(secondRegion.id);
  });
});
