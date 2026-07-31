import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  ViewAnnotation,
} from '@maplibre/maplibre-react-native';
import { OfflineRegion, OfflineRegionCenter } from '../types/location';
import { offlineMapManager } from '../services/offlineMapService';
import { mapService } from '../services/mapService';

interface OfflineCoverageMapProps {
  region: OfflineRegion;
  currentLocation?: OfflineRegionCenter;
}

// MapLibre freezes native component IDs after their first Fabric render.
// This screen mounts only one coverage overlay, so keep its IDs stable while
// updating the GeoJSON data and camera when the selected region changes.
const COVERAGE_SOURCE_ID = 'offline-coverage-source';
const COVERAGE_LAYER_ID = 'offline-coverage-fill';
const CURRENT_LOCATION_ANNOTATION_ID = 'offline-current-location';

const OfflineCoverageMapComponent: React.FC<OfflineCoverageMapProps> = ({
  region,
  currentLocation,
}) => {
  const isReady = region.isDownloaded && region.status === 'completed';
  const coverage = offlineMapManager.getCoverageFeature(region);
  const bounds: [number, number, number, number] = [
    region.bounds.minLng,
    region.bounds.minLat,
    region.bounds.maxLng,
    region.bounds.maxLat,
  ];

  return (
    <View style={styles.container}>
      <MapLibreMap
        style={styles.map}
        mapStyle={region.styleUrl || mapService.getActiveStyleUrl()}
        compass={false}
        attribution
        logo={false}
        touchZoom
        dragPan
      >
        <Camera
          key={region.id}
          initialViewState={{
            bounds,
            padding: { top: 24, right: 24, bottom: 24, left: 24 },
          }}
        />

        <GeoJSONSource id={COVERAGE_SOURCE_ID} data={coverage}>
          <Layer
            id={COVERAGE_LAYER_ID}
            type="fill"
            paint={{
              'fill-color': '#1A73E8',
              'fill-opacity': 0.2,
              'fill-outline-color': '#0B57D0',
            }}
          />
        </GeoJSONSource>

        {currentLocation && (
          <ViewAnnotation
            id={CURRENT_LOCATION_ANNOTATION_ID}
            lngLat={[currentLocation.longitude, currentLocation.latitude]}
          >
            <View style={styles.locationOuter}>
              <View style={styles.locationInner} />
            </View>
          </ViewAnnotation>
        )}
      </MapLibreMap>

      <View style={styles.legend}>
        <View style={styles.legendSwatch} />
        <Text style={styles.legendText}>
          {isReady ? 'Guaranteed offline coverage' : 'Planned coverage'} •{' '}
          {region.radiusKm.toFixed(1)} km
        </Text>
      </View>
    </View>
  );
};

export const OfflineCoverageMap = React.memo(
  OfflineCoverageMapComponent,
  (previous, next) =>
    previous.region.id === next.region.id &&
    previous.region.name === next.region.name &&
    previous.region.status === next.region.status &&
    previous.region.isDownloaded === next.region.isDownloaded &&
    previous.region.radiusKm === next.region.radiusKm &&
    previous.region.styleUrl === next.region.styleUrl &&
    previous.region.center.latitude === next.region.center.latitude &&
    previous.region.center.longitude === next.region.center.longitude &&
    previous.region.bounds.minLat === next.region.bounds.minLat &&
    previous.region.bounds.maxLat === next.region.bounds.maxLat &&
    previous.region.bounds.minLng === next.region.bounds.minLng &&
    previous.region.bounds.maxLng === next.region.bounds.maxLng &&
    previous.currentLocation?.latitude === next.currentLocation?.latitude &&
    previous.currentLocation?.longitude === next.currentLocation?.longitude,
);

const styles = StyleSheet.create({
  container: {
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#E8F0FE',
    borderWidth: 1,
    borderColor: '#C2E7FF',
  },
  map: {
    flex: 1,
  },
  legend: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  legendSwatch: {
    width: 13,
    height: 13,
    borderRadius: 7,
    marginRight: 7,
    backgroundColor: 'rgba(26, 115, 232, 0.28)',
    borderWidth: 1,
    borderColor: '#0B57D0',
  },
  legendText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#174EA6',
  },
  locationOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  locationInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#1A73E8',
  },
});
