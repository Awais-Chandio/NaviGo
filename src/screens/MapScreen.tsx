import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import {
  Map,
  Camera,
  ViewAnnotation,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { RequestLocationPermission } from '../permissions/locationPermission';
import Geolocation from 'react-native-geolocation-service';
import PersonPinCircle from '../assets/icons/personPinCircle.svg';

type userLocationType = {
  coords: {
    longitude: number;
    latitude: number;
    accuracy: number;
  };
};
export default function MapScreen() {
  const cameraRef = useRef<CameraRef>(null);
  const watchId = useRef<any>(null);

  const [userLocation, setUserLocation] = useState<userLocationType>({
    coords: {
      longitude: 68.3578,
      latitude: 25.396,
      accuracy: 0,
    },
  });
  const [isFollowingUser, setIsFollowingUser] = useState(true);
  const [address, setAddress] = useState('');

  function startWatchingLocation() {
    if (watchId.current !== null) {
      return;
    }

    watchId.current = Geolocation.watchPosition(
      position => {
        setUserLocation({
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
        });
        getAddressFromCoordinates(
          position.coords.latitude,
          position.coords.longitude,
        );
        if (isFollowingUser) {
          cameraRef.current?.flyTo({
            center: [position.coords.longitude, position.coords.latitude],
            zoom: 14,
            duration: 1000,
          });
        }
        console.log(position);
      },
      error => {
        console.log(error.code, error.message);
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 5,
        interval: 3000,
        fastestInterval: 2000,
        forceRequestLocation: true,
        showLocationDialog: true,
      },
    );
  }
  async function getAddressFromCoordinates(
    latitude: number,
    longitude: number,
  ) {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'MyPlacesTracker/1.0',
          },
        },
      );

      const data = await response.json();

      console.log('Reverse Geocoding:', data);

      setAddress(data.display_name ?? 'Address not found');
    } catch (error) {
      console.log('Reverse Geocoding Error:', error);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  async function getCurrentLocation() {
    const status = await RequestLocationPermission();
    if (!status) {
      return;
    }

    Geolocation.getCurrentPosition(
      position => {
        setUserLocation({
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
        });
        getAddressFromCoordinates(
          position.coords.latitude,
          position.coords.longitude,
        );
        startWatchingLocation();
        cameraRef.current?.flyTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 14,
          duration: 1000,
        });
        console.log(position);
      },
      error => {
        console.log(error.code, error.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
        distanceFilter: 5,
        forceRequestLocation: true,
        showLocationDialog: true,
      },
    );
  }

  useEffect(() => {
    console.log('useEffect');

    getCurrentLocation();

    return () => {
      console.log('cleanup');

      if (watchId.current !== null) {
        Geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <Map
        style={styles.map}
        mapStyle={'https://tiles.openfreemap.org/styles/bright'}
      >
        <Camera
          ref={cameraRef}
          zoom={14}
          center={[
            userLocation.coords.longitude,
            userLocation.coords.latitude,
          ]}
        />
        <ViewAnnotation
          id="Current-Location"
          lngLat={[userLocation.coords.longitude, userLocation.coords.latitude]}
        >
          <PersonPinCircle width={40} height={40} />
        </ViewAnnotation>
      </Map>
      <View style={styles.addressContainer}>
        <Text style={styles.addressText}>
          {address || 'Fetching address...'}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Current Location"
        style={({ pressed }) => [
          styles.button,
          {
            opacity: pressed ? 0.7 : 1,
            transform: [{ scale: pressed ? 0.95 : 1 }],
          },
        ]}
        onPress={() => getCurrentLocation()}
      >
        <PersonPinCircle
          width={45}
          height={45}
          fill="green"
          stroke="black"
          strokeWidth={0.5}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ac1818ff',
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#cb2029ff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  markerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#130304ff',
  },
  button: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    // backgroundColor: 'blue',

    justifyContent: 'center',
    alignItems: 'center',
  },
  addressContainer: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    elevation: 4,
  },

  addressText: {
    color: '#000',
    fontSize: 14,
  },
});
