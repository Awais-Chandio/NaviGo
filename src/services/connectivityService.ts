import { logger } from '../utils/logger';

export type ConnectivityMode = 'auto' | 'online' | 'offline';

export type NetworkType = 'wifi' | 'cellular' | 'none' | 'unknown';

export interface ConnectivityState {
  isOnline: boolean;
  mode: ConnectivityMode;
  networkType: NetworkType;
}

export type ConnectivityListener = (state: ConnectivityState) => void;

const CONNECTIVITY_PROBES: ReadonlyArray<{
  url: string;
  method: 'GET' | 'HEAD';
}> = [
  {
    url: 'https://clients3.google.com/generate_204',
    method: 'GET',
  },
  {
    // Check a service the app actually depends on as well. Google can be
    // blocked on otherwise-working networks, which must not force NaviGo into
    // a false offline state.
    url: 'https://tiles.openfreemap.org/styles/bright',
    method: 'HEAD',
  },
];

const CONNECTIVITY_TIMEOUT_MS = 4000;

export class ConnectivityService {
  private mode: ConnectivityMode = 'auto';
  private isOnline: boolean = true;
  private networkType: NetworkType = 'unknown';
  private listeners: Set<ConnectivityListener> = new Set();
  private verificationInFlight: Promise<boolean> | null = null;

  public async verifyConnection(): Promise<boolean> {
    if (this.mode === 'offline') {
      this.updateState(false, 'none');
      return false;
    }

    if (this.mode === 'online') {
      this.updateState(true, 'unknown');
      return true;
    }

    if (this.verificationInFlight) {
      return this.verificationInFlight;
    }

    const verification = this.checkReachability().then(reachable => {
      // A manual mode change supersedes an older automatic probe.
      if (this.mode === 'auto' && this.verificationInFlight === verification) {
        this.updateState(reachable, reachable ? 'unknown' : 'none');
      }
      return reachable;
    });

    this.verificationInFlight = verification;

    try {
      return await verification;
    } finally {
      if (this.verificationInFlight === verification) {
        this.verificationInFlight = null;
      }
    }
  }

  private async checkReachability(): Promise<boolean> {
    const results = await Promise.all(
      CONNECTIVITY_PROBES.map(({ url, method }) =>
        this.probeEndpoint(url, method),
      ),
    );
    return results.some(Boolean);
  }

  private async probeEndpoint(
    url: string,
    method: 'GET' | 'HEAD',
  ): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      CONNECTIVITY_TIMEOUT_MS,
    );

    try {
      // Any HTTP response proves that the network is reachable. Individual
      // feature requests still handle service-specific 4xx/5xx responses.
      await fetch(url, {
        method,
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private updateState(online: boolean, type: NetworkType) {
    const hasChanged = this.isOnline !== online || this.networkType !== type;
    this.isOnline = online;
    this.networkType = type;

    if (hasChanged) {
      const state = this.getState();
      this.listeners.forEach(listener => {
        try {
          listener(state);
        } catch (error) {
          logger.warn('Connectivity', 'Connectivity listener failed.', error);
        }
      });
    }
  }

  public setMode(mode: ConnectivityMode) {
    this.mode = mode;
    this.verificationInFlight = null;
    this.verifyConnection().catch(error => {
      logger.warn('Connectivity', 'Connectivity verification failed.', error);
    });
  }

  public getMode(): ConnectivityMode {
    return this.mode;
  }

  public isOnlineMode(): boolean {
    if (this.mode === 'offline') return false;
    if (this.mode === 'online') return true;
    return this.isOnline;
  }

  public getState(): ConnectivityState {
    return {
      isOnline: this.isOnlineMode(),
      mode: this.mode,
      networkType: this.networkType,
    };
  }

  public subscribe(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());

    return () => {
      this.listeners.delete(listener);
    };
  }

  public destroy() {
    this.listeners.clear();
  }
}

export const connectivityService = new ConnectivityService();
