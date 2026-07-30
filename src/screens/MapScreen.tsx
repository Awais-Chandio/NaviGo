import React, { useEffect, useRef, useCallback, useState } from 'react';
import { StyleSheet, StatusBar, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Map, Camera, ViewAnnotation, type CameraRef } from '@maplibre/maplibre-react-native';
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
import { TrafficLine } from '../components/TrafficLine';
import { NearbyPlacesCard } from '../components/NearbyPlacesCard';
import { RouteAlternativesCard } from '../components/RouteAlternativesCard';
import { OfflineMapsScreen } from './OfflineMapsScreen';

import { SearchPlaceItem } from '../services/searchService';
import { mapService } from '../services/mapService';
import { nearbyPlacesService } from '../services/NearbyPlacesService';
import { savedPlacesService } from '../services/SavedPlacesService';
import { NEARBY_CATEGORIES } from '../config/nearbyCategories';
import { LOCATION_CONFIG } from '../config/locationConfig';
import { NearbyCategory, NearbyPlace, SavedPlace } from '../types/places';
import { calculateBoundingBox, getHaversineDistance } from '../utils/locationUtils';
import { logger } from '../utils/logger';
import PersonPinCircle from '../assets/icons/personPinCircle.svg';

export default function MapScreen() {
  const cameraRef = useRef<CameraRef>(null);
  const followResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFollowingUser, setIsFollowingUser] = useState<boolean>(true);
  const [currentZoom, setCurrentZoom] = useState<number>(15);
  const [isOfflineMapsVisible, setIsOfflineMapsVisible] = useState<boolean>(false);

  // Nearby & Category search state
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeCategoryConfig, setActiveCategoryConfig] = useState<NearbyCategory | null>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [isLoadingNearby, setIsLoadingNearby] = useState<boolean>(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [selectedNearbyPlaceId, setSelectedNearbyPlaceId] = useState<string | null>(null);

  const {
    navigationState,
    destination,
    routes,
    selectedRouteIndex,
    routeDetails,
    isLoadingRoute,
    isRerouting,
    currentStep,
    distanceToStep,
    remainingDuration,
    formattedRemainingDistance,
    formattedRemainingDuration,
    currentBearing,
    currentSpeed,
    currentRoad,
    matchedLocation,
    nextInstruction,
    selectDestination,
    selectRouteIndex,
    startNavigation,
    cancelNavigation,
    handleLocationUpdate,
  } = useNavigation();

  const isNavigating = navigationState === 'navigating';
  const { location, detectedArea, locationError } = useLocation(isNavigating);
  const hasValidLocationFix =
    location.accuracy > 0 &&
    location.accuracy <=
      LOCATION_CONFIG.GPS_ACCURACY_MAX_THRESHOLD_METERS;
  const { recentSearches, savedPlaces, addRecentSearch } = useSavedPlaces();

  useEffect(() => {
    if (locationError) {
      setErrorMessage(locationError);
    }
  }, [locationError]);

  // Dynamic location update ref for active category search
  const lastFetchedLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const nearbyAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (
      selectedCategory &&
      activeCategoryConfig &&
      !activeCategoryConfig.isSavedPlace &&
      hasValidLocationFix
    ) {
      if (lastFetchedLocationRef.current) {
        const distMoved = getHaversineDistance(
          lastFetchedLocationRef.current.latitude,
          lastFetchedLocationRef.current.longitude,
          location.latitude,
          location.longitude,
        );
        if (distMoved < LOCATION_CONFIG.NEARBY_REQUERY_THRESHOLD_METERS) return;
      }

      lastFetchedLocationRef.current = {
        latitude: location.latitude,
        longitude: location.longitude,
      };

      nearbyAbortRef.current?.abort();
      const controller = new AbortController();
      nearbyAbortRef.current = controller;
      setIsLoadingNearby(true);
      setNearbyError(null);
      nearbyPlacesService
        .searchNearby({
          latitude: location.latitude,
          longitude: location.longitude,
          category: activeCategoryConfig.category,
          radius: LOCATION_CONFIG.DEFAULT_NEARBY_SEARCH_RADIUS_KM,
        }, controller.signal)
        .then(results => {
          if (!controller.signal.aborted) {
            setNearbyPlaces(results);
          }
        })
        .catch(err => {
          if (
            !controller.signal.aborted &&
            (!err ||
              typeof err !== 'object' ||
              !('name' in err) ||
              (err as { name: string }).name !== 'AbortError')
          ) {
            logger.warn('MapScreen', 'Dynamic nearby search update error:', err);
            setNearbyError('Unable to load nearby places right now.');
          }
        })
        .finally(() => {
          if (
            !controller.signal.aborted &&
            nearbyAbortRef.current === controller
          ) {
            setIsLoadingNearby(false);
            nearbyAbortRef.current = null;
          }
        });
    }
    return () => {
      nearbyAbortRef.current?.abort();
    };
  }, [
    activeCategoryConfig,
    hasValidLocationFix,
    location.latitude,
    location.longitude,
    selectedCategory,
  ]);

  // Determine displayed marker location (map matched or raw GPS)
  const markerLat =
    isNavigating && matchedLocation && matchedLocation.confidence > 0.4
      ? matchedLocation.latitude
      : location.latitude;

  const markerLng =
    isNavigating && matchedLocation && matchedLocation.confidence > 0.4
      ? matchedLocation.longitude
      : location.longitude;

  useEffect(() => {
    if (location.latitude && location.longitude) {
      handleLocationUpdate(
        location.latitude,
        location.longitude,
        location.heading,
        location.accuracy,
        location.speed,
        location.timestamp,
      );
    }
  }, [
    handleLocationUpdate,
    location.accuracy,
    location.heading,
    location.latitude,
    location.longitude,
    location.speed,
    location.timestamp,
  ]);

  useEffect(() => {
    if (navigationState === 'navigating') {
      if (followResumeTimerRef.current) {
        clearTimeout(followResumeTimerRef.current);
        followResumeTimerRef.current = null;
      }
      setIsFollowingUser(true);
    }
  }, [navigationState]);

  useEffect(
    () => () => {
      if (followResumeTimerRef.current) {
        clearTimeout(followResumeTimerRef.current);
      }
    },
    [],
  );

  const lastCameraPosRef = useRef<{ lat: number; lng: number; bearing: number } | null>(null);
  const lastCameraUpdateTsRef = useRef<number>(0);

  useEffect(() => {
    if (isFollowingUser && cameraRef.current && location.latitude && location.longitude) {
      const targetLat = navigationState === 'navigating' ? markerLat : location.latitude;
      const targetLng = navigationState === 'navigating' ? markerLng : location.longitude;
      const targetBearing = navigationState === 'navigating' ? currentBearing : 0;
      const now = Date.now();

      // Cooldown & distance guard to prevent camera animation cancellations & tile thrashing
      if (lastCameraPosRef.current) {
        const timeSinceLastUpdate = now - lastCameraUpdateTsRef.current;
        const distMoved = getHaversineDistance(
          lastCameraPosRef.current.lat,
          lastCameraPosRef.current.lng,
          targetLat,
          targetLng,
        );
        const rawBearingDiff = Math.abs(
          lastCameraPosRef.current.bearing - targetBearing,
        );
        const bearingDiff = Math.min(rawBearingDiff, 360 - rawBearingDiff);

        if (
          distMoved < 2 &&
          bearingDiff < 5 &&
          timeSinceLastUpdate <
            LOCATION_CONFIG.NAVIGATION_CAMERA_THROTTLE_MS
        ) {
          return;
        }
      }

      lastCameraPosRef.current = { lat: targetLat, lng: targetLng, bearing: targetBearing };
      lastCameraUpdateTsRef.current = now;

      if (navigationState === 'navigating') {
        // Destination proximity camera view tuning
        let targetPitch = 50;
        let targetZoom = 17.5;
        let cameraCenter: [number, number] = [targetLng, targetLat];

        if (destination) {
          const distToDest = getHaversineDistance(
            targetLat,
            targetLng,
            destination.latitude,
            destination.longitude,
          );
          if (distToDest <= 300) {
            targetPitch = distToDest <= 100 ? 25 : 35;
            targetZoom = distToDest <= 100 ? 16.5 : 16.8;
            // Shift the camera toward the destination on final approach. The
            // user remains visible while both markers share the viewport.
            const destinationWeight = distToDest <= 100 ? 0.35 : 0.22;
            cameraCenter = [
              targetLng +
                (destination.longitude - targetLng) * destinationWeight,
              targetLat +
                (destination.latitude - targetLat) * destinationWeight,
            ];
          }
        }

        cameraRef.current.easeTo({
          center: cameraCenter,
          zoom: targetZoom,
          pitch: targetPitch,
          bearing: targetBearing,
          duration: 650,
        });
      } else {
        cameraRef.current.easeTo({
          center: [targetLng, targetLat],
          duration: 500,
        });
      }
    }
  }, [
    currentBearing,
    destination,
    isFollowingUser,
    location.latitude,
    location.longitude,
    markerLat,
    markerLng,
    navigationState,
  ]);



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

  const handleMapTouch = useCallback(() => {
    if (isFollowingUser) {
      setIsFollowingUser(false);
    }
    if (followResumeTimerRef.current) {
      clearTimeout(followResumeTimerRef.current);
    }
    if (navigationState === 'navigating') {
      followResumeTimerRef.current = setTimeout(() => {
        setIsFollowingUser(true);
        followResumeTimerRef.current = null;
      }, LOCATION_CONFIG.NAVIGATION_CAMERA_FOLLOW_RESUME_MS);
    }
  }, [isFollowingUser, navigationState]);

  const handleSelectPlace = useCallback(
    (item: SearchPlaceItem) => {
      if (!hasValidLocationFix) {
        setErrorMessage('Wait for an accurate GPS fix before requesting a route.');
        return;
      }
      addRecentSearch(item);
      selectDestination(location.latitude, location.longitude, {
        latitude: item.latitude,
        longitude: item.longitude,
        title: item.title,
        subtitle: item.subtitle,
      });
    },
    [
      addRecentSearch,
      hasValidLocationFix,
      location.latitude,
      location.longitude,
      selectDestination,
    ],
  );

  const handleSelectSavedPlace = useCallback(
    (saved: SavedPlace) => {
      if (!hasValidLocationFix) {
        setErrorMessage('Wait for an accurate GPS fix before requesting a route.');
        return;
      }
      selectDestination(location.latitude, location.longitude, {
        latitude: saved.latitude,
        longitude: saved.longitude,
        title: saved.name,
        subtitle: saved.address,
      });
    },
    [
      hasValidLocationFix,
      location.latitude,
      location.longitude,
      selectDestination,
    ],
  );

  const handleCategoryPress = useCallback(
    async (category: NearbyCategory) => {
      if (selectedCategory === category.id) {
        setSelectedCategory(null);
        setActiveCategoryConfig(null);
        setNearbyPlaces([]);
        setSelectedNearbyPlaceId(null);
        return;
      }

      setSelectedCategory(category.id);
      setActiveCategoryConfig(category);
      setSelectedNearbyPlaceId(null);
      setNearbyError(null);
      lastFetchedLocationRef.current = null;
      nearbyAbortRef.current?.abort();

      if (category.isSavedPlace && category.savedType) {
        setNearbyPlaces([]);
        const savedPlace = await savedPlacesService.getPlaceByType(category.savedType);
        if (savedPlace) {
          if (!hasValidLocationFix) {
            setErrorMessage(
              'Wait for an accurate GPS fix before requesting a route.',
            );
            return;
          }
          selectDestination(location.latitude, location.longitude, {
            latitude: savedPlace.latitude,
            longitude: savedPlace.longitude,
            title: savedPlace.name,
            subtitle: savedPlace.address,
          });

          if (cameraRef.current) {
            cameraRef.current.easeTo({
              center: [savedPlace.longitude, savedPlace.latitude],
              zoom: 16,
              duration: 1000,
            });
          }
          setIsFollowingUser(false);
        } else {
          setErrorMessage(
            `${category.title} is not set. Save a ${category.title.toLowerCase()} location first.`,
          );
        }
      } else {
        setNearbyPlaces([]);
        if (!hasValidLocationFix) {
          setIsLoadingNearby(false);
          setNearbyError('An accurate GPS fix is required for nearby search.');
        }
      }
    },
    [
      hasValidLocationFix,
      selectedCategory,
      location.latitude,
      location.longitude,
      selectDestination,
    ],
  );

  const handleSelectNearbyPlace = useCallback((place: NearbyPlace) => {
    setSelectedNearbyPlaceId(place.id);
    if (cameraRef.current) {
      cameraRef.current.easeTo({
        center: [place.longitude, place.latitude],
        zoom: 16,
        duration: 800,
      });
    }
    setIsFollowingUser(false);
  }, []);

  const handleNavigateToNearbyPlace = useCallback(
    (place: NearbyPlace) => {
      if (!hasValidLocationFix) {
        setErrorMessage('Wait for an accurate GPS fix before requesting a route.');
        return;
      }
      selectDestination(location.latitude, location.longitude, {
        latitude: place.latitude,
        longitude: place.longitude,
        title: place.name,
        subtitle: place.address,
      });
      if (cameraRef.current) {
        cameraRef.current.easeTo({
          center: [place.longitude, place.latitude],
          zoom: 16,
          duration: 800,
        });
      }
      setIsFollowingUser(false);
    },
    [
      hasValidLocationFix,
      location.latitude,
      location.longitude,
      selectDestination,
    ],
  );

  const handleCloseNearbyCard = useCallback(() => {
    setSelectedCategory(null);
    setActiveCategoryConfig(null);
    setNearbyPlaces([]);
    setSelectedNearbyPlaceId(null);
    setNearbyError(null);
    nearbyAbortRef.current?.abort();
    nearbyAbortRef.current = null;
  }, []);

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

  const handleRecenter = useCallback(() => {
    if (followResumeTimerRef.current) {
      clearTimeout(followResumeTimerRef.current);
      followResumeTimerRef.current = null;
    }
    setIsFollowingUser(true);
    if (cameraRef.current) {
      cameraRef.current.flyTo({
        center: [location.longitude, location.latitude],
        zoom: navigationState === 'navigating' ? 17.5 : 15,
        pitch: navigationState === 'navigating' ? 50 : 0,
        bearing: navigationState === 'navigating' ? currentBearing : 0,
        duration: 1000,
      });
    }
  }, [
    currentBearing,
    location.latitude,
    location.longitude,
    navigationState,
  ]);

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

  const showNearbyCard =
    selectedCategory !== null &&
    activeCategoryConfig !== null &&
    !activeCategoryConfig.isSavedPlace;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={'dark-content'} backgroundColor={'#FFFFFF'} />

      <ErrorToast
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />

      {navigationState === 'navigating' && (
        <TurnInstructionCard
          currentStep={currentStep}
          distanceToStep={distanceToStep}
        />
      )}

      {/* Single Unified Header Container */}
      <SearchHeader
        userLocation={{
          latitude: location.latitude,
          longitude: location.longitude,
        }}
        navigationState={navigationState}
        recentSearches={recentSearches}
        savedPlaces={savedPlaces}
        categories={NEARBY_CATEGORIES}
        selectedCategory={selectedCategory}
        onCategoryPress={handleCategoryPress}
        onSelectPlace={handleSelectPlace}
        onSelectSavedPlace={handleSelectSavedPlace}
      />

      <Map
        style={styles.map}
        mapStyle={mapService.getActiveStyleUrl()}
        onTouchStart={handleMapTouch}
      >
        {hasValidLocationFix && (
          <AccuracyCircle
            longitude={location.longitude}
            latitude={location.latitude}
            accuracy={location.accuracy}
          />
        )}

        {routeDetails && (
          <>
            <RouteLine coordinates={routeDetails.coordinates} />
            <TrafficLine
              coordinates={routeDetails.coordinates}
              visible={navigationState === 'navigating' || navigationState === 'route_ready'}
            />
          </>
        )}

        <Camera
          ref={cameraRef}
          initialViewState={{
            zoom: currentZoom,
            center: [markerLng, markerLat],
          }}
        />

        {hasValidLocationFix && (
          <UserMarker
            longitude={markerLng}
            latitude={markerLat}
            bearing={currentBearing}
            isNavigating={navigationState === 'navigating'}
          />
        )}

        {destination && (
          <DestinationMarker
            longitude={destination.longitude}
            latitude={destination.latitude}
          />
        )}

        {nearbyPlaces.map(place => (
          <ViewAnnotation
            key={place.id}
            id={`nearby-place-${place.id}`}
            lngLat={[place.longitude, place.latitude]}
          >
            <TouchableOpacity
              onPress={() => handleSelectNearbyPlace(place)}
              activeOpacity={0.8}
              style={styles.nearbyMarker}
            >
              <PersonPinCircle
                width={selectedNearbyPlaceId === place.id ? 40 : 32}
                height={selectedNearbyPlaceId === place.id ? 40 : 32}
                fill={selectedNearbyPlaceId === place.id ? '#1A73E8' : '#EA4335'}
                stroke="#FFFFFF"
                strokeWidth={1.5}
              />
            </TouchableOpacity>
          </ViewAnnotation>
        ))}
      </Map>

      <MapControls
        bearing={currentBearing}
        hasDestination={destination !== null}
        isFollowingUser={isFollowingUser}
        onResetCompass={handleResetCompass}
        onRecenter={handleRecenter}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onOpenOfflineMaps={() => setIsOfflineMapsVisible(true)}
      />

      {showNearbyCard && (
        <NearbyPlacesCard
          categoryTitle={activeCategoryConfig.title}
          categoryIcon={activeCategoryConfig.icon}
          detectedArea={detectedArea}
          places={nearbyPlaces}
          isLoading={isLoadingNearby}
          selectedPlaceId={selectedNearbyPlaceId}
          error={nearbyError}
          onSelectPlace={handleSelectNearbyPlace}
          onNavigateToPlace={handleNavigateToNearbyPlace}
          onClose={handleCloseNearbyCard}
        />
      )}

      {navigationState === 'route_ready' && destination && routes.length > 0 && (
        <RouteAlternativesCard
          routes={routes}
          selectedIndex={selectedRouteIndex}
          destinationTitle={destination.title}
          onSelectRouteIndex={selectRouteIndex}
          onStartNavigation={startNavigation}
          onCancel={cancelNavigation}
        />
      )}

      {navigationState === 'navigating' && (
        <NavigationCard
          navigationState={navigationState}
          destination={destination}
          isLoadingRoute={isLoadingRoute}
          isRerouting={isRerouting}
          formattedDistance={formattedRemainingDistance}
          formattedDuration={formattedRemainingDuration}
          remainingDurationSeconds={remainingDuration}
          currentSpeed={currentSpeed}
          currentRoad={currentRoad}
          nextInstruction={nextInstruction}
          onStartNavigation={startNavigation}
          onCancelNavigation={cancelNavigation}
        />
      )}


      <OfflineMapsScreen
        visible={isOfflineMapsVisible}
        userLocation={
          hasValidLocationFix
            ? {
                latitude: location.latitude,
                longitude: location.longitude,
              }
            : undefined
        }
        onClose={() => setIsOfflineMapsVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  map: {
    flex: 1,
  },
  nearbyMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
