import { check, PERMISSIONS, request, RESULTS } from 'react-native-permissions';
import { Alert, Platform } from 'react-native';

export async function RequestLocationPermission() {
  const permission =
    Platform.OS === 'android'
      ? PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION
      : PERMISSIONS.IOS.LOCATION_WHEN_IN_USE;

  try {
    const status = await check(permission);
    console.log('status', status);
    switch (status) {
      case RESULTS.GRANTED:
        return true;
      case RESULTS.BLOCKED:
        Alert.alert('Permission is blocked', 'Please enable permission');
        return false;
      case RESULTS.DENIED:
        const requestPerm = await request(permission);
        return requestPerm === RESULTS.GRANTED;
      case RESULTS.UNAVAILABLE:
        Alert.alert('Permission is unavailable', 'Please enable permission');
        return false;
      case RESULTS.LIMITED:
        return true;
      default:
        return false;
    }
  } catch (error) {
    console.log(error);
    return false;
  }
}
