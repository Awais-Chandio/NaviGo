import React from 'react';
import { act, create } from 'react-test-renderer';
import { GeoJSONSource } from '@maplibre/maplibre-react-native';
import { AccuracyCircle } from '../../src/components/AccuracyCircle';

describe('AccuracyCircle', () => {
  it('renders valid coordinates on the equator and prime meridian', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <AccuracyCircle longitude={0} latitude={0} accuracy={10} />,
      );
    });

    const source = renderer!.root.findByType(GeoJSONSource);
    expect(source.props.data.geometry.type).toBe('Polygon');
  });

  it('does not render non-finite coordinates', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <AccuracyCircle longitude={Number.NaN} latitude={0} accuracy={10} />,
      );
    });

    expect(renderer!.toJSON()).toBeNull();
  });
});
