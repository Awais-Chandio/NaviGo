import { useEffect,useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Map, Camera, ViewAnnotation } from '@maplibre/maplibre-react-native';
import { RequestLocationPermission } from '../permissions/locationPermission';
import Geolocation from 'react-native-geolocation-service';

export default function MapScreen() {
  type userLocationType={
    coords:{
        longitude:number;
        latitude:number;
    }
  }  
  const [userLocation, setUserLocation] = useState<userLocationType | null>(null);
  const place = {
    id: '1',
    name: 'Hyderabad',
    lng: 68.3578,
    lat: 25.396,
  };

  async function getCurrentLocation() {
    const status = await RequestLocationPermission();
    if (!status) {
      return;
    }
    Geolocation.getCurrentPosition((position)=>{
        console.log(position)
    }, (error)=>{
        console.log(error.code, error.message)
    },
     {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
     }
)
  }

  useEffect(() => {
    getCurrentLocation();
  }, []);

  return (
    <View style={styles.container}>
      <Map
        style={styles.map}
        mapStyle={'https://tiles.openfreemap.org/styles/bright'}
      >
        <Camera center={[68.3578, 25.396]} zoom={14} />
        <ViewAnnotation id={place.id} lngLat={[place.lng, place.lat]}>
          <View style={styles.markerContainer}>
            <View style={styles.markerDot} />
          </View>
        </ViewAnnotation>
      </Map>
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
});
