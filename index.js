/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { LogManager } from '@maplibre/maplibre-react-native';
import App from './App';
import { name as appName } from './app.json';

// MapLibre reports HTTP/2 streams cancelled by a camera/style change as a
// warning even though the replacement tile request continues normally. Hide
// only that expected cancellation; real HTTP and map errors stay visible.
LogManager.onLog(({ level, tag, message }) => {
  return (
    level === 'warn' &&
    tag === 'Mbgl-HttpRequest' &&
    (message.includes('stream was reset: CANCEL') ||
      message.startsWith('Request failed due to a permanent error: Canceled'))
  );
});

AppRegistry.registerComponent(appName, () => App);
