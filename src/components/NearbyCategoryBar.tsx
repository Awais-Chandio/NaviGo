import React from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Text,
  View,
} from 'react-native';
import { NearbyCategory } from '../types/places';

interface NearbyCategoryBarProps {
  categories: NearbyCategory[];
  selectedCategory: string | null;
  onCategoryPress: (category: NearbyCategory) => void;
}

const NearbyCategoryBarComponent: React.FC<NearbyCategoryBarProps> = ({
  categories,
  selectedCategory,
  onCategoryPress,
}) => {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {categories.map(cat => {
          const isSelected = selectedCategory === cat.id;

          return (
            <Pressable
              key={cat.id}
              style={({ pressed }) => [
                styles.chip,
                isSelected ? styles.selectedChip : styles.unselectedChip,
                pressed && styles.pressedChip,
              ]}
              onPress={() => onCategoryPress(cat)}
            >
              <Text style={styles.icon}>{cat.icon}</Text>
              <Text
                style={[
                  styles.title,
                  isSelected ? styles.selectedTitle : styles.unselectedTitle,
                ]}
              >
                {cat.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 6,
    zIndex: 10,
  },
  scrollContent: {
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  unselectedChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EAED',
  },
  selectedChip: {
    backgroundColor: '#1A73E8',
    borderColor: '#1A73E8',
  },
  pressedChip: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  icon: {
    fontSize: 15,
    marginRight: 6,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  unselectedTitle: {
    color: '#3C4043',
  },
  selectedTitle: {
    color: '#FFFFFF',
  },
});

export const NearbyCategoryBar = React.memo(NearbyCategoryBarComponent);
