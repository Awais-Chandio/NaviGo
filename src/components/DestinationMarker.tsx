import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ViewAnnotation } from '@maplibre/maplibre-react-native';
import PersonPinCircle from '../assets/icons/personPinCircle.svg';

interface DestinationMarkerProps {
  longitude: number;
  latitude: number;
}

export const DestinationMarker: React.FC<DestinationMarkerProps> = ({
  longitude,
  latitude,
}) => {
  return (
    <ViewAnnotation id="searched-destination-marker" lngLat={[longitude, latitude]}>
      <View style={styles.container}>
        <PersonPinCircle
          width={44}
          height={44}
          fill="#ea4335"
          stroke="#ffffff"
          strokeWidth={1.5}
        />
      </View>
    </ViewAnnotation>
  );
};

const styles = StyleSheet.create({
  container: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  },
});
