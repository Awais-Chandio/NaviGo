import React, { ErrorInfo, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { logger } from '../utils/logger';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  public state: AppErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('App', 'A render error reached the app boundary.', error, {
      componentStack: info.componentStack,
    });
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  public render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={styles.container} accessibilityRole="alert">
        <Text style={styles.title}>NaviGo hit an unexpected problem</Text>
        <Text style={styles.message}>
          Your saved places and downloaded maps are safe. Try loading the map
          again.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try loading NaviGo again"
          onPress={this.handleRetry}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.retryButtonPressed,
          ]}
        >
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#F8FAFD',
  },
  title: {
    color: '#202124',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    marginTop: 10,
    color: '#5F6368',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 22,
    minHeight: 46,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    backgroundColor: '#1A73E8',
    paddingHorizontal: 22,
  },
  retryButtonPressed: {
    opacity: 0.82,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
