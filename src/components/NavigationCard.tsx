import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { NavigationState, DestinationInfo } from '../hooks/useNavigation';

interface NavigationCardProps {
  navigationState: NavigationState;
  destination: DestinationInfo | null;
  isLoadingRoute: boolean;
  formattedDistance: string;
  formattedDuration: string;
  nextInstruction: string;
  onStartNavigation: () => void;
  onCancelNavigation: () => void;
}

export const NavigationCard: React.FC<NavigationCardProps> = ({
  navigationState,
  destination,
  isLoadingRoute,
  formattedDistance,
  formattedDuration,
  nextInstruction,
  onStartNavigation,
  onCancelNavigation,
}) => {
  if (!destination || navigationState === 'idle') return null;

  const isNavigating = navigationState === 'navigating';

  return (
    <View style={styles.container}>
      {/* Active Navigation Header Instruction Banner */}
      {isNavigating && (
        <View style={styles.instructionBanner}>
          <Text style={styles.instructionIcon}>🏎️</Text>
          <Text style={styles.instructionText} numberOfLines={2}>
            {nextInstruction || 'Continue straight along route'}
          </Text>
        </View>
      )}

      {/* Main Destination Info Header */}
      <View style={styles.cardHeader}>
        <View style={styles.titleColumn}>
          <Text style={styles.destTitle} numberOfLines={1}>
            {destination.title}
          </Text>
          <Text style={styles.destSubtitle} numberOfLines={1}>
            {destination.subtitle}
          </Text>
        </View>

        <Pressable onPress={onCancelNavigation} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>
            {isNavigating ? 'Exit' : 'Clear'}
          </Text>
        </Pressable>
      </View>

      {/* Route Metrics Row */}
      <View style={styles.metricsRow}>
        <View style={styles.metricBadge}>
          <Text style={styles.metricLabel}>Distance</Text>
          <Text style={styles.metricValue}>{formattedDistance}</Text>
        </View>

        <View style={styles.metricBadge}>
          <Text style={styles.metricLabel}>Remaining Time</Text>
          <Text style={styles.metricValueHighlight}>{formattedDuration}</Text>
        </View>
      </View>

      {/* Action Button for Route Ready Mode */}
      {navigationState === 'route_ready' && (
        <View style={styles.actionRow}>
          {isLoadingRoute ? (
            <ActivityIndicator size="small" color="#1a73e8" />
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 20,
  },
  instructionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a73e8',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
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
    borderRadius: 10,
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
    fontSize: 16,
    fontWeight: '700',
    color: '#202124',
  },
  metricValueHighlight: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a73e8',
  },
  actionRow: {
    marginTop: 12,
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
