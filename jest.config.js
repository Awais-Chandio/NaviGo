module.exports = {
  preset: '@react-native/jest-preset',
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-native-async-storage|@maplibre/maplibre-react-native|react-native-permissions|react-native-geolocation-service)/)',
  ],
  moduleNameMapper: {
    '\\.svg$': '<rootDir>/__tests__/__mocks__/svgMock.js',
  },
};
