export const LOCATION_CONFIG = {
  /** Movement threshold in meters to trigger automatic nearby search re-query */
  NEARBY_REQUERY_THRESHOLD_METERS: 150,

  /** Distance threshold in meters to trigger reverse geocoding update */
  ADDRESS_GEOCODE_THRESHOLD_METERS: 50,

  /** Maximum allowed accuracy radius in meters for GPS fix filtering */
  GPS_ACCURACY_MAX_THRESHOLD_METERS: 30,

  /** Min distance change in meters required for native geolocation watch updates */
  GPS_DISTANCE_FILTER_METERS: 5,

  /** Location watch interval in ms */
  GPS_WATCH_INTERVAL_MS: 3000,

  /** Location watch fastest interval in ms */
  GPS_WATCH_FASTEST_INTERVAL_MS: 1500,

  /** Default operating region: Hyderabad, Sindh, Pakistan */
  DEFAULT_REGION: {
    latitude: 25.396,
    longitude: 68.3578,
    cityName: 'Hyderabad',
    stateName: 'Sindh',
    countryName: 'Pakistan',
    countryCode: 'PK',
  },

  /** Priority areas in Hyderabad to boost in ranking */
  HYDERABAD_PRIORITY_AREAS: [
    'qasimabad',
    'latifabad',
    'city',
    'autobahn',
    'hala naka',
    'saddar',
    'hirabad',
  ],

  /** Mandatory auto-expansion search radius steps for nearby places (meters) */
  NEARBY_RADIUS_STEPS_METERS: [2000, 5000, 10000],

  /** Max high quality nearby results to return */
  MAX_NEARBY_RESULTS: 20,

  /** Default search radius in km for nearby places */
  DEFAULT_NEARBY_SEARCH_RADIUS_KM: 2,

  /** Guaranteed circular coverage radius for a current-area offline download */
  DEFAULT_OFFLINE_REGION_RADIUS_KM: 10,

  /** Safe city-wide fallback coverage for Hyderabad when boundary lookup is unavailable */
  DEFAULT_CITY_OFFLINE_RADIUS_KM: 25,

  /** Battery optimization - Location watch interval in normal mode (ms) */
  NORMAL_LOCATION_INTERVAL: 5000,

  /** Battery optimization - Location watch interval in navigation mode (ms) */
  NAVIGATION_LOCATION_INTERVAL: 1000,

  /** Route deviation distance threshold in meters before triggering auto-rerouting */
  ROUTE_DEVIATION_THRESHOLD_METERS: 30,

  /** Minimum time delay between consecutive automatic rerouting attempts (ms) */
  REROUTE_COOLDOWN_MS: 15000,

  /** Time a user must remain outside the route corridor before rerouting */
  OFF_ROUTE_CONFIRMATION_MS: 3000,

  /** Distance threshold in meters to declare arrival at destination */
  ARRIVAL_THRESHOLD_METERS: 20,

  /** Minimum interval between full navigation progress calculations */
  NAVIGATION_CALCULATION_THROTTLE_MS: 500,

  /** Maximum plausible road speed used when rejecting GPS jumps (m/s) */
  GPS_MAX_PLAUSIBLE_SPEED_MPS: 60,

  /** Camera animation cadence while turn-by-turn navigation is active */
  NAVIGATION_CAMERA_THROTTLE_MS: 500,

  /** Resume navigation camera follow after temporary manual map exploration */
  NAVIGATION_CAMERA_FOLLOW_RESUME_MS: 8000,
};
