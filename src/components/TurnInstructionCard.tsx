import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationStep } from '../services/routingService';

interface TurnInstructionCardProps {
  currentStep: NavigationStep | null;
  distanceToStep: string;
}

export const TurnInstructionCard: React.FC<TurnInstructionCardProps> = ({
  currentStep,
  distanceToStep,
}) => {
  const insets = useSafeAreaInsets();
  if (!currentStep) return null;

  const dynamicTop = Math.max(insets.top + 10, 16);

  return (
    <View style={[styles.bannerContainer, { top: dynamicTop }]}>
      <View style={styles.iconContainer}>
        <Text style={styles.maneuverIcon}>{currentStep.iconSymbol || '↑'}</Text>
      </View>

      <View style={styles.textContainer}>
        <Text style={styles.distanceText}>
          {distanceToStep || currentStep.formattedDistance}
        </Text>
        <Text style={styles.instructionText} numberOfLines={2}>
          {currentStep.instruction}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bannerContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    maxWidth: 600,
    alignSelf: 'center',
    width: '92%',
    zIndex: 30,
    backgroundColor: '#0d652d', // Google Maps dark green navigation banner color
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  iconContainer: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  maneuverIcon: {
    fontSize: 28,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  textContainer: {
    flex: 1,
  },
  distanceText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 2,
  },
  instructionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#e8f0fe',
  },
});
