import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MapScreen from './src/screens/MapScreen';
import { SplashScreen } from './src/components/SplashScreen';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';

export default function App() {
  const [isSplashActive, setIsSplashActive] = useState<boolean>(true);

  const handleSplashFinish = useCallback(() => {
    setIsSplashActive(false);
  }, []);

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <AppErrorBoundary>
          <MapScreen />
        </AppErrorBoundary>
        {isSplashActive && <SplashScreen onFinish={handleSplashFinish} />}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
});
