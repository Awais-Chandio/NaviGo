import { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import { Map, Camera, ViewAnnotation, type CameraRef } from '@maplibre/maplibre-react-native';
import { RequestLocationPermission } from '../permissions/locationPermission';
import Geolocation from 'react-native-geolocation-service';

type userLocationType = {
  coords: {
    longitude: number;
    latitude: number;
    accuracy: number;
  }
}
export default function MapScreen() {
  const cameraRef = useRef<CameraRef>(null);
  const watchId = useRef<any>(null);

  
  const [userLocation, setUserLocation] = useState<userLocationType>({
    coords: {
      longitude: 68.3578,
      latitude: 25.396,
      accuracy: 0
    }
  });
  function startWatchingLocation() {
      if (watchId.current !== null) {
    return;
  }

    watchId.current = Geolocation.watchPosition(
      (position) => {
        setUserLocation({
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          }
        });

        cameraRef.current?.flyTo({
          center: [
            position.coords.longitude,
            position.coords.latitude
          ],
          zoom: 14,
          duration: 1000,
        });
        console.log(position)
      }, (error) => {
        console.log(error.code, error.message)
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 5,
        interval: 3000,
        fastestInterval: 2000,
      }
    )
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  async function getCurrentLocation() {
    const status = await RequestLocationPermission();
    if (!status) {

      return;
    }


    Geolocation.getCurrentPosition((position) => {
      setUserLocation({
        coords: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        },
      })
      startWatchingLocation();
      cameraRef.current?.flyTo({
        center: [
          position.coords.longitude,
          position.coords.latitude
        ],
        zoom: 14,
        duration: 1000,
      });
      console.log(position)
    }, (error) => {
      console.log(error.code, error.message)
    },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
        distanceFilter: 5,
      }
    )
  }


 useEffect(() => {
  console.log("useEffect");

  getCurrentLocation();

  return () => {
    console.log("cleanup");

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
/>
        <ViewAnnotation id="Current-Location" lngLat={[userLocation.coords.longitude, userLocation.coords.latitude]}>
          <View style={styles.markerContainer}>
            <View style={styles.markerDot} />
          </View>
        </ViewAnnotation>
      </Map>
      
        <Pressable style={styles.button} onPress={() => getCurrentLocation()} /> 
      <Text>{userLocation.coords.latitude}, {userLocation.coords.longitude}</Text>
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
    width: 60,
    height: 60,
    backgroundColor:'red',
    
  },

})
