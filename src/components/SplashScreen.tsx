import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Image,
  useWindowDimensions,
} from 'react-native';

interface SplashScreenProps {
  onFinish: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const { width } = useWindowDimensions();

  // Animation drivers (native driver enabled)
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const exitFadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // 1. Entrance parallel animation (Scale + Fade In)
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // 2. Continuous subtle pulse animation
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    pulseLoop.start();

    // 3. Exit animation after 2.2 seconds
    const timer = setTimeout(() => {
      pulseLoop.stop();
      Animated.timing(exitFadeAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start(() => {
        onFinish();
      });
    }, 2200);

    return () => clearTimeout(timer);
  }, [exitFadeAnim, fadeAnim, onFinish, pulseAnim, scaleAnim]);

  const logoSize = Math.min(width * 0.38, 160);

  return (
    <Animated.View style={[styles.container, { opacity: exitFadeAnim }]}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Animated Icon Container */}
        <Animated.View
          style={[
            styles.iconWrapper,
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          <Image
            source={require('../assets/icons/personPinCircle.svg')} // fallback or vector badge
            style={{ width: logoSize, height: logoSize }}
            resizeMode="contain"
          />
          <View style={styles.iconOverlayPin}>
            <Text style={styles.pinEmoji}>🧭</Text>
          </View>
        </Animated.View>

        {/* App Title & Subtitle */}
        <Text style={styles.title}>NaviGo</Text>
        <Text style={styles.subtitle}>Smart Turn-by-Turn Navigation</Text>

        {/* Loading indicator dots bar */}
        <View style={styles.loaderBar}>
          <View style={styles.loaderDot} />
          <View style={[styles.loaderDot, styles.loaderDotActive]} />
          <View style={styles.loaderDot} />
        </View>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#38bdf8',
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    marginBottom: 24,
  },
  iconOverlayPin: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinEmoji: {
    fontSize: 54,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 1.5,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#94a3b8',
    marginTop: 6,
  },
  loaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 36,
  },
  loaderDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#334155',
  },
  loaderDotActive: {
    backgroundColor: '#38bdf8',
    width: 20,
  },
});
