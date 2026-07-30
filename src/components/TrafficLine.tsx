import React, { useEffect, useState } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { trafficService, TrafficSegment } from '../services/TrafficService';

interface TrafficLineProps {
  coordinates: [number, number][];
  visible?: boolean;
}

export const TrafficLine: React.FC<TrafficLineProps> = React.memo(({
  coordinates,
  visible = true,
}) => {
  const [trafficSegments, setTrafficSegments] = useState<TrafficSegment[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!coordinates || coordinates.length < 2 || !visible) {
      setTrafficSegments([]);
      return () => {
        cancelled = true;
      };
    }

    trafficService.fetchTrafficSegments(coordinates).then(segments => {
      if (!cancelled) {
        setTrafficSegments(segments);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [coordinates, visible]);

  if (!visible || trafficSegments.length === 0) return null;

  const features = trafficSegments.map((segment, index) => ({
    type: 'Feature' as const,
    properties: {
      id: index,
      color: segment.color,
      speed: segment.speed,
    },
    geometry: {
      type: 'LineString' as const,
      coordinates: [segment.start, segment.end],
    },
  }));

  return (
    <GeoJSONSource
      id="trafficSource"
      data={{
        type: 'FeatureCollection',
        features,
      }}
    >
      <Layer
        type="line"
        id="trafficLineLayer"
        paint={{
          'line-color': ['get', 'color'],
          'line-width': 5,
          'line-opacity': 0.9,
        }}
      />
    </GeoJSONSource>
  );
});
