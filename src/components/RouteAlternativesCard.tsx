import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { RouteDetails } from '../services/routingService';

interface RouteAlternativesCardProps {
  routes: RouteDetails[];
  selectedIndex: number;
  destinationTitle: string;
  onSelectRouteIndex: (index: number) => void;
  onStartNavigation: () => void;
  onCancel: () => void;
}

export const RouteAlternativesCardComponent: React.FC<RouteAlternativesCardProps> = ({
  routes,
  selectedIndex,
  destinationTitle,
  onSelectRouteIndex,
  onStartNavigation,
  onCancel,
}) => {
  if (!routes || routes.length === 0) return null;

  const activeRoute = routes[selectedIndex] || routes[0];

  return (
    <View style={styles.cardContainer}>
      <View style={styles.header}>
        <View style={styles.titleInfo}>
          <Text style={styles.destTitle} numberOfLines={1}>
            Route to {destinationTitle}
          </Text>

          <Text style={styles.destSubtitle}>
            {activeRoute.formattedDuration} • {activeRoute.formattedDistance}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={onCancel}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.cancelText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Alternative Route Selectors */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.routesScroll}
      >
        {routes.map((rt, idx) => {
          const isSelected = selectedIndex === idx;
          const badgeColor =
            rt.tag === 'Fastest' ? '#1E8E3E' : rt.tag === 'Shortest' ? '#1A73E8' : '#F9AB00';

          return (
            <TouchableOpacity
              key={rt.id || `rt_${idx}`}
              style={[
                styles.routePill,
                isSelected ? styles.selectedPill : styles.unselectedPill,
              ]}
              onPress={() => onSelectRouteIndex(idx)}
              activeOpacity={0.8}
            >
              <View style={[styles.badge, { backgroundColor: badgeColor }]}>
                <Text style={styles.badgeText}>{rt.tag || `Route ${idx + 1}`}</Text>
              </View>
              <Text style={[styles.pillTime, isSelected && styles.selectedPillText]}>
                {rt.formattedDuration}
              </Text>
              <Text style={styles.pillDist}>{rt.formattedDistance}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <TouchableOpacity
        style={styles.startBtn}
        onPress={onStartNavigation}
        activeOpacity={0.85}
      >
        <Text style={styles.startBtnText}>Start Navigation</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    elevation: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    zIndex: 25,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  titleInfo: {
    flex: 1,
    marginRight: 10,
  },
  destTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 2,
  },
  destSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A73E8',
  },
  cancelBtn: {
    padding: 6,
    backgroundColor: '#F1F3F4',
    borderRadius: 14,
  },
  cancelText: {
    fontSize: 14,
    color: '#5F6368',
    fontWeight: 'bold',
  },
  routesScroll: {
    paddingVertical: 6,
    gap: 10,
    marginBottom: 12,
  },
  routePill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    minWidth: 100,
    alignItems: 'center',
  },
  unselectedPill: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#DADCE0',
  },
  selectedPill: {
    backgroundColor: '#E8F0FE',
    borderWidth: 2,
    borderColor: '#1A73E8',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginBottom: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  pillTime: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3C4043',
  },
  selectedPillText: {
    color: '#1A73E8',
  },
  pillDist: {
    fontSize: 11,
    color: '#70757A',
    marginTop: 2,
  },
  startBtn: {
    backgroundColor: '#1A73E8',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#1A73E8',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  startBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

export const RouteAlternativesCard = React.memo(RouteAlternativesCardComponent);
