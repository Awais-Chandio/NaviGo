import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';

interface SearchBarProps {
  value: string;
  placeholder?: string;
  isLoading?: boolean;
  onChangeText: (text: string) => void;
  onClear?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const SearchBarComponent: React.FC<SearchBarProps> = ({
  value,
  placeholder = 'Search destination, places, fuel, food...',
  isLoading = false,
  onChangeText,
  onClear,
  onFocus,
  onBlur,
}) => {
  const [isFocused, setIsFocused] = useState<boolean>(false);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    if (onFocus) onFocus();
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    if (onBlur) onBlur();
  }, [onBlur]);

  return (
    <View style={[styles.container, isFocused && styles.containerFocused]}>
      <Text style={styles.searchIcon}>🔍</Text>
      <TextInput
        style={styles.input}
        value={value}
        placeholder={placeholder}
        placeholderTextColor="#9AA0A6"
        onChangeText={onChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        returnKeyType="search"
        clearButtonMode="never"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {isLoading ? (
        <ActivityIndicator size="small" color="#1A73E8" style={styles.spinner} />
      ) : value.length > 0 && onClear ? (
        <TouchableOpacity
          style={styles.clearButton}
          onPress={onClear}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.clearIcon}>✕</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

export const SearchBar = React.memo(SearchBarComponent);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    backgroundColor: '#F1F3F4',
    borderRadius: 24,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  containerFocused: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1A73E8',
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#202124',
    paddingVertical: 0,
  },
  spinner: {
    marginLeft: 8,
  },
  clearButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E8EAED',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  clearIcon: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#5F6368',
  },
});

