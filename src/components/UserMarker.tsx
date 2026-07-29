import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ViewAnnotation } from '@maplibre/maplibre-react-native';
import PersonPinCircle from '../assets/icons/personPinCircle.svg';

interface UserMarkerProps {
  longitude: number;
  latitude: number;
  bearing?: number;
  isNavigating?: boolean;
}

export const UserMarker: React.FC<UserMarkerProps> = ({
  longitude,
  latitude,
  bearing = 0,
  isNavigating = false,
}) => {
  return (
    <ViewAnnotation id="user-gps-marker" lngLat={[longitude, latitude]}>
      <View
        style={[
          styles.container,
          isNavigating && { transform: [{ rotate: `${bearing}deg` }] },
        ]}
      >
        <PersonPinCircle
          width={40}
          height={40}
          fill="#1a73e8"
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
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
});
