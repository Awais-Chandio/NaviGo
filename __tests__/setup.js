jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  return {
    Map: ({ children }: any) => React.createElement(React.Fragment, null, children),
    Camera: React.forwardRef(() => null),
    ViewAnnotation: ({ children }: any) => React.createElement(React.Fragment, null, children),
    GeoJSONSource: ({ children }: any) => React.createElement(React.Fragment, null, children),
    Layer: () => null,
    OfflineManager: {
      setTileCountLimit: jest.fn(),
      getPacks: jest.fn(() => Promise.resolve([])),
      createPack: jest.fn(),
      deletePack: jest.fn(() => Promise.resolve()),
      clearAmbientCache: jest.fn(() => Promise.resolve()),
    },
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
  getAllKeys: jest.fn(() => Promise.resolve([])),
  multiGet: jest.fn(() => Promise.resolve([])),
  multiSet: jest.fn(() => Promise.resolve()),
  multiRemove: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native-geolocation-service', () => ({
  getCurrentPosition: jest.fn(cb => cb({ coords: { latitude: 25.396, longitude: 68.3578, accuracy: 10, heading: 0, speed: 0 } })),
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
}));

jest.mock('react-native-permissions', () => ({
  PERMISSIONS: {
    ANDROID: { ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION' },
    IOS: { LOCATION_WHEN_IN_USE: 'ios.permission.LOCATION_WHEN_IN_USE' },
  },
  RESULTS: { GRANTED: 'granted' },
  check: jest.fn(() => Promise.resolve('granted')),
  request: jest.fn(() => Promise.resolve('granted')),
}));
