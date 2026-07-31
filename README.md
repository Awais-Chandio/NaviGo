# NaviGo

NaviGo is a React Native CLI and TypeScript navigation application using
MapLibre, OpenFreeMap/OpenStreetMap data, Photon search, Overpass nearby
queries, OSRM driving routes, GPS tracking, and MapLibre offline tile packs.

## Architecture

- `src/screens`: screen composition and map UI
- `src/hooks`: location, navigation, and saved-place orchestration
- `src/services`: domain state, persistence, GPS, navigation, and offline packs
- `src/repositories`: Photon, Overpass, and OSRM transport/parsing
- `src/utils`: geodesic, route-progress, ranking, logging, and network helpers

The app currently uses foreground location only. Downloaded MapLibre regions
provide offline rendering for their exact style and zoom range. Offline search
and offline road-graph routing are not installed; the app deliberately refuses
to fabricate straight-line driving routes.

## Setup

Requirements:

- Node.js 22.11 or newer
- Android SDK/API 36 and a compatible JDK
- Xcode and CocoaPods for iOS

Install JavaScript dependencies:

```sh
npm ci
```

Install iOS pods after dependency or Podfile changes:

```sh
cd ios
bundle exec pod install
cd ..
```

Run the app:

```sh
npm start
npm run android
# or
npm run ios
```

## Verification

```sh
npm run verify
cd android && ./gradlew app:assembleDebug
```

Release builds require Android signing properties named
`NAVIGO_UPLOAD_STORE_FILE`, `NAVIGO_UPLOAD_STORE_PASSWORD`,
`NAVIGO_UPLOAD_KEY_ALIAS`, and `NAVIGO_UPLOAD_KEY_PASSWORD`.

## External services

- Photon: autocomplete and reverse geocoding
- Overpass API: nearby POIs
- OSRM: online driving routes and alternatives
- OpenFreeMap: MapLibre vector-map styles and tiles

The checked-in endpoints are public community services, not contractual
production SLAs. A public release with sustained traffic should use
organization-controlled or contracted endpoints, monitoring, quotas, and an
appropriate privacy policy. Requests include timeouts, cancellation, bounded
in-memory caching, response validation, and conservative retries.

Map attribution remains enabled through MapLibre. OpenStreetMap-derived data
must retain the attribution required by its data providers.

## Location and offline behavior

- Android requires precise/fine foreground location.
- iOS includes only the `LocationWhenInUse` permission handler.
- GPS fixes over the configured accuracy threshold are rejected.
- Offline regions store a name, center, radius, covered area, download date,
  version, size, and status in a cached metadata index.
- The Offline Maps screen visualizes the guaranteed circular coverage area and
  reports whether the current GPS fix is inside a completed region.
- The native MapLibre pack downloads the circle's enclosing tile bounds; the
  same center and radius drive its metadata, UI, map boundary, duplicate
  detection, and navigation coverage checks.
- Active offline map packs are reconciled and observed after relaunch without
  repeatedly scanning map files.
- A map pack stores render resources; it is not a routable road graph.

For genuine offline routing, ship a versioned regional road graph and integrate
a real offline routing engine before enabling that feature in the UI.
