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
  const laneInfo = currentStep.lanes;

  const renderLaneIcon = (
    lane: string,
    isRecommended: boolean,
    index: number,
  ) => {
    let symbol = '⬆';
    if (lane === 'left') symbol = '⬅';
    if (lane === 'right') symbol = '➡';

    return (
      <View
        key={`${lane}-${index}`}
        style={[
          styles.laneChip,
          isRecommended ? styles.laneChipActive : styles.laneChipInactive,
        ]}
      >
        <Text
          style={[
            styles.laneSymbol,
            isRecommended ? styles.laneSymbolActive : styles.laneSymbolInactive,
          ]}
        >
          {symbol}
        </Text>
      </View>
    );
  };

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

        {laneInfo && laneInfo.lanes && laneInfo.lanes.length > 0 && (
          <View style={styles.lanesContainer}>
            {laneInfo.lanes.map((lane, index) =>
              renderLaneIcon(lane, lane === laneInfo.recommendedLane, index),
            )}
          </View>
        )}
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
    backgroundColor: '#0d652d',
    borderRadius: 16,
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
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  maneuverIcon: {
    fontSize: 30,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  textContainer: {
    flex: 1,
  },
  distanceText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 2,
  },
  instructionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#e8f0fe',
  },
  lanesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  laneChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  laneChipActive: {
    backgroundColor: '#ffffff',
  },
  laneChipInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  laneSymbol: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  laneSymbolActive: {
    color: '#0d652d',
  },
  laneSymbolInactive: {
    color: '#e8f0fe',
  },
});
