import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationState, DestinationInfo } from '../hooks/useNavigation';
import { voiceService } from '../services/voiceService';

interface NavigationCardProps {
  navigationState: NavigationState;
  destination: DestinationInfo | null;
  isLoadingRoute: boolean;
  isRerouting?: boolean;
  formattedDistance: string;
  formattedDuration: string;
  remainingDurationSeconds?: number;
  currentSpeed?: number;
  currentRoad?: string;
  nextInstruction: string;
  onStartNavigation: () => void;
  onCancelNavigation: () => void;
}

export const NavigationCard: React.FC<NavigationCardProps> = React.memo(({
  navigationState,
  destination,
  isLoadingRoute,
  isRerouting = false,
  formattedDistance,
  formattedDuration,
  remainingDurationSeconds = 0,
  currentSpeed = 0,
  currentRoad = '',
  nextInstruction,
  onStartNavigation,
  onCancelNavigation,
}) => {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(200)).current;
  const [isMuted, setIsMuted] = useState<boolean>(voiceService.isMuted());

  useEffect(() => {
    if (destination && navigationState !== 'idle') {
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }).start();
    } else {
      slideAnim.setValue(200);
    }
  }, [destination, navigationState, slideAnim]);

  const handleToggleVoice = () => {
    const nextMuted = !isMuted;
    voiceService.setMuted(nextMuted);
    setIsMuted(nextMuted);
  };

  const estimatedETA = useMemo(() => {
    if (!remainingDurationSeconds || remainingDurationSeconds <= 0) return '--:--';
    const etaDate = new Date(Date.now() + remainingDurationSeconds * 1000);
    return etaDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [remainingDurationSeconds]);

  if (!destination || navigationState === 'idle') return null;

  const isNavigating = navigationState === 'navigating';
  const dynamicBottom = Math.max(insets.bottom + 12, 16);

  return (
    <Animated.View
      style={[
        styles.container,
        { bottom: dynamicBottom, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={styles.sheetHandleBar} />

      {isNavigating && (
        <View style={[styles.instructionBanner, isRerouting && styles.reroutingBanner]}>
          {isRerouting ? (
            <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 10 }} />
          ) : (
            <Text style={styles.instructionIcon}>🏎️</Text>
          )}
          <Text style={styles.instructionText} numberOfLines={2}>
            {isRerouting ? 'Recalculating route...' : nextInstruction || 'Continue straight along route'}
          </Text>
        </View>
      )}

      <View style={styles.cardHeader}>
        <View style={styles.titleColumn}>
          <View style={styles.titleRow}>
            <Text style={styles.destTitle} numberOfLines={1}>
              {destination.title}
            </Text>
          </View>
          <Text style={styles.destSubtitle} numberOfLines={1}>
            {currentRoad ? `On: ${currentRoad}` : destination.subtitle}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <Pressable onPress={handleToggleVoice} style={styles.iconButton}>
            <Text style={styles.iconButtonText}>{isMuted ? '🔇' : '🔊'}</Text>
          </Pressable>

          <Pressable onPress={onCancelNavigation} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>
              {isNavigating ? 'Exit' : 'Clear'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricBadge}>
          <Text style={styles.metricLabel}>Distance</Text>
          <Text style={styles.metricValue}>{formattedDistance}</Text>
        </View>

        <View style={styles.metricBadge}>
          <Text style={styles.metricLabel}>Est. Duration</Text>
          <Text style={styles.metricValueHighlight}>{formattedDuration}</Text>
        </View>

        <View style={styles.metricBadge}>
          <Text style={styles.metricLabel}>Arrival ETA</Text>
          <Text style={styles.metricValueEta}>{estimatedETA}</Text>
        </View>

        {isNavigating && (
          <View style={styles.metricBadge}>
            <Text style={styles.metricLabel}>Speed</Text>
            <Text style={styles.metricValue}>{currentSpeed} km/h</Text>
          </View>
        )}
      </View>


      {navigationState === 'route_ready' && (
        <View style={styles.actionRow}>
          {isLoadingRoute ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#1a73e8" />
              <Text style={styles.loadingText}>Calculating best route...</Text>
            </View>
          ) : (
            <Pressable
              onPress={onStartNavigation}
              style={({ pressed }) => [
                styles.startButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.startButtonIcon}>🧭</Text>
              <Text style={styles.startButtonText}>Start Navigation</Text>
            </Pressable>
          )}
        </View>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    maxWidth: 600,
    alignSelf: 'center',
    width: '92%',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 20,
  },
  sheetHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e0e0e0',
    alignSelf: 'center',
    marginBottom: 10,
  },
  instructionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a73e8',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  reroutingBanner: {
    backgroundColor: '#e65100',
  },

  instructionIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  instructionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleColumn: {
    flex: 1,
    marginRight: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  destTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#202124',
  },
  destSubtitle: {
    fontSize: 13,
    color: '#70757a',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    backgroundColor: '#f1f3f4',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconButtonText: {
    fontSize: 16,
  },
  closeButton: {
    backgroundColor: '#f1f3f4',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  closeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#d93025',
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 12,
  },
  metricBadge: {
    flex: 1,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 12,
    color: '#70757a',
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#202124',
  },
  metricValueHighlight: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a73e8',
  },
  metricValueEta: {
    fontSize: 15,
    fontWeight: '700',
    color: '#34a853',
  },
  actionRow: {
    marginTop: 12,
  },
  loadingContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a73e8',
  },
  startButton: {
    flexDirection: 'row',
    backgroundColor: '#34a853',
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#34a853',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 4,
  },
  startButtonIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
