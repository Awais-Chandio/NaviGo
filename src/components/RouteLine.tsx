import React from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';

interface RouteLineProps {
  coordinates: [number, number][];
}

export const RouteLine: React.FC<RouteLineProps> = ({ coordinates }) => {
  if (!coordinates || coordinates.length === 0) return null;

  return (
    <GeoJSONSource
      id="routeSource"
      data={{
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates,
        },
      }}
    >
      <Layer
        type="line"
        id="routeLine"
        paint={{
          'line-color': '#1a73e8',
          'line-width': 7,
          'line-opacity': 0.85,
        }}
      />
    </GeoJSONSource>
  );
};
