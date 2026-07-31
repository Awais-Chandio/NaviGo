import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { AppErrorBoundary } from '../../src/components/AppErrorBoundary';

describe('AppErrorBoundary', () => {
  it('shows a safe recovery screen and retries rendering', () => {
    let shouldThrow = true;
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const TestChild = () => {
      if (shouldThrow) {
        throw new Error('render failure');
      }
      return <Text>Map restored</Text>;
    };

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <AppErrorBoundary>
          <TestChild />
        </AppErrorBoundary>,
      );
    });

    expect(
      renderer!.root.findByProps({
        accessibilityLabel: 'Try loading NaviGo again',
      }),
    ).toBeTruthy();

    shouldThrow = false;
    act(() => {
      renderer!.root
        .findByProps({ accessibilityLabel: 'Try loading NaviGo again' })
        .props.onPress();
    });

    expect(renderer!.root.findByType(TestChild)).toBeTruthy();
    consoleError.mockRestore();
  });
});
