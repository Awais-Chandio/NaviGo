import React from 'react';
import {
  Pressable,
  StyleSheet,
  ViewStyle,
  StyleProp,
  Text,
  View,
} from 'react-native';

interface FloatingButtonProps {
  onPress: () => void;
  icon?: React.ReactNode;
  emoji?: string;
  size?: number;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export const FloatingButton: React.FC<FloatingButtonProps> = ({
  onPress,
  icon,
  emoji,
  size = 48,
  active = false,
  style,
  accessibilityLabel,
}) => {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size, borderRadius: size / 2 },
        active && styles.activeButton,
        pressed && styles.pressed,
        style,
      ]}
    >
      {icon ? (
        icon
      ) : (
        <Text style={styles.emojiText}>{emoji}</Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 6,
  },
  activeButton: {
    borderWidth: 2,
    borderColor: '#1a73e8',
  },
  emojiText: {
    fontSize: 20,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.95 }],
  },
});
