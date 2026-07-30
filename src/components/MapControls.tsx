import React from 'react';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PersonPinCircle from '../assets/icons/personPinCircle.svg';

interface MapControlsProps {
  bearing: number;
  hasDestination: boolean;
  isFollowingUser?: boolean;
  onResetCompass: () => void;
  onRecenter: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOpenOfflineMaps?: () => void;
}

export const MapControls: React.FC<MapControlsProps> = ({
  bearing,
  hasDestination,
  isFollowingUser = true,
  onResetCompass,
  onRecenter,
  onZoomIn,
  onZoomOut,
  onOpenOfflineMaps,
}) => {
  const insets = useSafeAreaInsets();

  const dynamicBottom = hasDestination
    ? Math.max(insets.bottom + 230, 230)
    : Math.max(insets.bottom + 24, 24);

  return (
    <View style={[styles.container, { bottom: dynamicBottom }]}>
      {onOpenOfflineMaps && (
        <Pressable
          accessibilityLabel="Offline Maps"
          style={({ pressed }) => [styles.controlBtn, pressed && styles.pressed]}
          onPress={onOpenOfflineMaps}
        >
          <Text style={styles.iconText}>📥</Text>
        </Pressable>
      )}

      <Pressable
        accessibilityLabel="Zoom In"
        style={({ pressed }) => [styles.controlBtn, pressed && styles.pressed]}
        onPress={onZoomIn}
      >
        <Text style={styles.zoomText}>＋</Text>
      </Pressable>

      <Pressable
        accessibilityLabel="Zoom Out"
        style={({ pressed }) => [styles.controlBtn, pressed && styles.pressed]}
        onPress={onZoomOut}
      >
        <Text style={styles.zoomText}>－</Text>
      </Pressable>

      <Pressable
        accessibilityLabel="Reset Compass Bearing"
        style={({ pressed }) => [styles.controlBtn, pressed && styles.pressed]}
        onPress={onResetCompass}
      >
        <View style={{ transform: [{ rotate: `${-bearing}deg` }] }}>
          <Text style={styles.compassText}>🧭</Text>
        </View>
      </Pressable>

      <Pressable
        accessibilityLabel="Re-center location"
        style={({ pressed }) => [
          styles.controlBtn,
          styles.recenterBtn,
          !isFollowingUser && styles.recenterBtnInactive,
          pressed && styles.pressed,
        ]}
        onPress={onRecenter}
      >
        <PersonPinCircle
          width={38}
          height={38}
          fill={isFollowingUser ? '#34a853' : '#1a73e8'}
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
    right: 16,
    zIndex: 10,
    gap: 10,
    alignItems: 'center',
  },
  controlBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 6,
  },
  recenterBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    marginTop: 4,
  },
  recenterBtnInactive: {
    borderWidth: 2,
    borderColor: '#1A73E8',
  },
  zoomText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#202124',
  },
  compassText: {
    fontSize: 22,
  },
  iconText: {
    fontSize: 20,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
});
