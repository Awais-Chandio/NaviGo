import React, { useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';

interface AccuracyCircleProps {
  longitude: number;
  latitude: number;
  accuracy: number; // radius in meters
}

/**
 * Creates a GeoJSON Polygon circle around lat/lng with given radius in meters.
 */
function createGeoJSONCircle(
  lng: number,
  lat: number,
  radiusMeters: number,
  points: number = 64,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords = {
    latitude: lat,
    longitude: lng,
  };

  const km = Math.max(radiusMeters, 5) / 1000;
  const ret: [number, number][] = [];
  const distanceX = km / (111.32 * Math.cos((coords.latitude * Math.PI) / 180));
  const distanceY = km / 110.574;

  let theta: number;
  let x: number;
  let y: number;

  for (let i = 0; i < points; i++) {
    theta = (i / points) * (2 * Math.PI);
    x = distanceX * Math.cos(theta);
    y = distanceY * Math.sin(theta);
    ret.push([coords.longitude + x, coords.latitude + y]);
  }
  ret.push(ret[0]);

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [ret],
    },
    properties: {},
  };
}

export const AccuracyCircle: React.FC<AccuracyCircleProps> = ({
  longitude,
  latitude,
  accuracy,
}) => {
  const circleGeoJSON = useMemo(() => {
    if (!longitude || !latitude) return null;
    return createGeoJSONCircle(longitude, latitude, accuracy || 15);
  }, [longitude, latitude, accuracy]);

  if (!circleGeoJSON) return null;

  return (
    <GeoJSONSource id="user-accuracy-source" data={circleGeoJSON}>
      <Layer
        id="user-accuracy-layer"
        type="fill"
        paint={{
          'fill-color': '#1a73e8',
          'fill-opacity': 0.15,
          'fill-outline-color': '#1a73e8',
        }}
      />
    </GeoJSONSource>
  );
};
