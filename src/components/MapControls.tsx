import React from 'react';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import PersonPinCircle from '../assets/icons/personPinCircle.svg';

interface MapControlsProps {
  bearing: number;
  isDarkMode: boolean;
  hasDestination: boolean;
  onResetCompass: () => void;
  onToggleMapStyle: () => void;
  onRecenter: () => void;
}

export const MapControls: React.FC<MapControlsProps> = ({
  bearing,
  isDarkMode,
  hasDestination,
  onResetCompass,
  onToggleMapStyle,
  onRecenter,
}) => {
  return (
    <View
      style={[
        styles.container,
        hasDestination && styles.containerShifted,
      ]}
    >
      {/* Compass Button */}
      <Pressable
        accessibilityLabel="Reset Map Bearing"
        style={({ pressed }) => [
          styles.controlBtn,
          pressed && styles.pressed,
        ]}
        onPress={onResetCompass}
      >
        <View
          style={[
            styles.compassNeedle,
            { transform: [{ rotate: `${-bearing}deg` }] },
          ]}
        >
          <Text style={styles.compassText}>🧭</Text>
        </View>
      </Pressable>

      {/* Map Style Switcher (Light / Dark) */}
      <Pressable
        accessibilityLabel="Toggle Dark Mode Map"
        style={({ pressed }) => [
          styles.controlBtn,
          pressed && styles.pressed,
        ]}
        onPress={onToggleMapStyle}
      >
        <Text style={styles.btnIcon}>{isDarkMode ? '☀️' : '🌙'}</Text>
      </Pressable>

      {/* Recenter Location Button */}
      <Pressable
        accessibilityLabel="Re-center to location"
        style={({ pressed }) => [
          styles.controlBtn,
          styles.recenterBtn,
          pressed && styles.pressed,
        ]}
        onPress={onRecenter}
      >
        <PersonPinCircle
          width={38}
          height={38}
          fill="#34a853"
          stroke="#ffffff"
          strokeWidth={1}
        />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 30,
    right: 16,
    zIndex: 10,
    gap: 10,
  },
  containerShifted: {
    bottom: 210,
  },
  controlBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 6,
  },
  recenterBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  btnIcon: {
    fontSize: 20,
  },
  compassNeedle: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  compassText: {
    fontSize: 22,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
});
