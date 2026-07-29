import React, { useEffect, useRef, useCallback, useState } from 'react';
import { StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Map, Camera, type CameraRef } from '@maplibre/maplibre-react-native';
import { useLocation } from '../hooks/useLocation';
import { useNavigation } from '../hooks/useNavigation';
import { useSavedPlaces } from '../hooks/useSavedPlaces';
import { SearchHeader } from '../components/SearchHeader';
import { NavigationCard } from '../components/NavigationCard';
import { TurnInstructionCard } from '../components/TurnInstructionCard';
import { MapControls } from '../components/MapControls';
import { ErrorToast } from '../components/ErrorToast';
import { UserMarker } from '../components/UserMarker';
import { DestinationMarker } from '../components/DestinationMarker';
import { AccuracyCircle } from '../components/AccuracyCircle';
import { RouteLine } from '../components/RouteLine';
import { SearchPlaceItem } from '../services/searchService';
import { SavedPlace } from '../services/storageService';
import { calculateBoundingBox } from '../utils/locationUtils';

const LIGHT_MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';
const DARK_MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';

export default function MapScreen() {
  const cameraRef = useRef<CameraRef>(null);

  // Map Tile & Custom Hooks
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFollowingUser, setIsFollowingUser] = useState<boolean>(true);
  const [currentZoom, setCurrentZoom] = useState<number>(15);

  const { location, refreshLocation } = useLocation();
  const { recentSearches, savedPlaces, addRecentSearch } = useSavedPlaces();

  const {
    navigationState,
    destination,
    routeDetails,
    isLoadingRoute,
    currentStep,
    distanceToStep,
    formattedRemainingDistance,
    formattedRemainingDuration,
    currentBearing,
    nextInstruction,
    selectDestination,
    startNavigation,
    cancelNavigation,
    handleLocationUpdate,
  } = useNavigation();

  // Forward live location updates to navigation engine and follow user
  useEffect(() => {
    if (location.latitude && location.longitude) {
      handleLocationUpdate(
        location.latitude,
        location.longitude,
        location.heading,
      );

      // Camera follow behavior during navigation or live tracking
      if (isFollowingUser && cameraRef.current) {
        if (navigationState === 'navigating') {
          cameraRef.current.flyTo({
            center: [location.longitude, location.latitude],
            zoom: 17.5,
            pitch: 50,
            bearing: currentBearing,
            duration: 1000,
          });
        } else {
          cameraRef.current.easeTo({
            center: [location.longitude, location.latitude],
            duration: 800,
          });
        }
      }
    }
  }, [currentBearing, handleLocationUpdate, isFollowingUser, location, navigationState]);

  // Fit camera bounds when route becomes ready
  useEffect(() => {
    if (
      navigationState === 'route_ready' &&
      routeDetails?.coordinates &&
      cameraRef.current
    ) {
      const bounds = calculateBoundingBox(routeDetails.coordinates);
      cameraRef.current.fitBounds(bounds, {
        padding: { top: 100, right: 60, bottom: 240, left: 60 },
        duration: 1200,
      });
      setIsFollowingUser(false);
    }
  }, [navigationState, routeDetails]);

  /**
   * Stop camera auto-follow when user touches / moves the map manually
   */
  const handleMapTouch = useCallback(() => {
    if (isFollowingUser) {
      setIsFollowingUser(false);
    }
  }, [isFollowingUser]);

  /**
   * Select place suggestion handler
   */
  const handleSelectPlace = useCallback(
    (item: SearchPlaceItem) => {
      addRecentSearch(item);
      selectDestination(location.latitude, location.longitude, {
        latitude: item.latitude,
        longitude: item.longitude,
        title: item.title,
        subtitle: item.subtitle,
      });
    },
    [addRecentSearch, location.latitude, location.longitude, selectDestination],
  );

  /**
   * Select saved place shortcut handler (Home / Work)
   */
  const handleSelectSavedPlace = useCallback(
    (saved: SavedPlace) => {
      selectDestination(location.latitude, location.longitude, {
        latitude: saved.latitude,
        longitude: saved.longitude,
        title: saved.title,
        subtitle: saved.subtitle,
      });
    },
    [location.latitude, location.longitude, selectDestination],
  );

  /**
   * Reset Compass Bearing & Pitch
   */
  const handleResetCompass = useCallback(() => {
    if (cameraRef.current) {
      cameraRef.current.easeTo({
        center: [location.longitude, location.latitude],
        zoom: currentZoom,
        pitch: 0,
        bearing: 0,
        duration: 1000,
      });
    }
  }, [currentZoom, location.latitude, location.longitude]);

  /**
   * Recenter Camera to User Position & resume tracking
   */
  const handleRecenter = useCallback(() => {
    setIsFollowingUser(true);
    refreshLocation();
    if (cameraRef.current) {
      cameraRef.current.flyTo({
        center: [location.longitude, location.latitude],
        zoom: navigationState === 'navigating' ? 17.5 : 15,
        pitch: navigationState === 'navigating' ? 50 : 0,
        bearing: navigationState === 'navigating' ? currentBearing : 0,
        duration: 1000,
      });
    }
  }, [currentBearing, location.latitude, location.longitude, navigationState, refreshLocation]);

  /**
   * Zoom In handler
   */
  const handleZoomIn = useCallback(() => {
    const nextZoom = Math.min(currentZoom + 1, 20);
    setCurrentZoom(nextZoom);
    if (cameraRef.current) {
      cameraRef.current.easeTo({
        center: [location.longitude, location.latitude],
        zoom: nextZoom,
        duration: 300,
      });
    }
  }, [currentZoom, location.latitude, location.longitude]);

  /**
   * Zoom Out handler
   */
  const handleZoomOut = useCallback(() => {
    const nextZoom = Math.max(currentZoom - 1, 2);
    setCurrentZoom(nextZoom);
    if (cameraRef.current) {
      cameraRef.current.easeTo({
        center: [location.longitude, location.latitude],
        zoom: nextZoom,
        duration: 300,
      });
    }
  }, [currentZoom, location.latitude, location.longitude]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle={'dark-content'}
        backgroundColor={'#ffffff'}
      />

      {/* Floating Network / GPS Error Toast */}
      <ErrorToast
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />

      {/* Top Floating Turn-by-Turn Instruction Card Banner (During Navigation) */}
      {navigationState === 'navigating' && (
        <TurnInstructionCard
          currentStep={currentStep}
          distanceToStep={distanceToStep}
        />
      )}

      {/* Floating Autocomplete Search Bar & Shortcuts (Browsing Mode) */}
      <SearchHeader
        userLocation={{
          latitude: location.latitude,
          longitude: location.longitude,
        }}
        navigationState={navigationState}
        recentSearches={recentSearches}
        savedPlaces={savedPlaces}
        onSelectPlace={handleSelectPlace}
        onSelectSavedPlace={handleSelectSavedPlace}
      />

      {/* Main Map Component */}
      <Map
        style={styles.map}
        mapStyle={LIGHT_MAP_STYLE}
        onTouchStart={handleMapTouch}
      >
        {/* Location Accuracy Circle */}
        <AccuracyCircle
          longitude={location.longitude}
          latitude={location.latitude}
          accuracy={location.accuracy}
        />

        {/* Polyline Route Layer */}
        {routeDetails && (
          <RouteLine coordinates={routeDetails.coordinates} />
        )}

        {/* Camera */}
        <Camera
          ref={cameraRef}
          zoom={currentZoom}
          center={[location.longitude, location.latitude]}
        />

        {/* User GPS Marker */}
        <UserMarker
          longitude={location.longitude}
          latitude={location.latitude}
          bearing={currentBearing}
          isNavigating={navigationState === 'navigating'}
        />

        {/* Destination Marker */}
        {destination && (
          <DestinationMarker
            longitude={destination.longitude}
            latitude={destination.latitude}
          />
        )}
      </Map>

      {/* Floating Map Control Stack */}
      <MapControls
        bearing={currentBearing}
        hasDestination={destination !== null}
        isFollowingUser={isFollowingUser}
        onResetCompass={handleResetCompass}
        onRecenter={handleRecenter}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
      />

      {/* Bottom Route Summary & Turn-by-Turn Navigation Panel */}
      <NavigationCard
        navigationState={navigationState}
        destination={destination}
        isLoadingRoute={isLoadingRoute}
        formattedDistance={formattedRemainingDistance}
        formattedDuration={formattedRemainingDuration}
        nextInstruction={nextInstruction}
        onStartNavigation={startNavigation}
        onCancelNavigation={cancelNavigation}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  map: {
    flex: 1,
  },
});
