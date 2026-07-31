import { logger } from '../utils/logger';

export type ConnectivityMode = 'auto' | 'online' | 'offline';

export type NetworkType = 'wifi' | 'cellular' | 'none' | 'unknown';

export interface ConnectivityState {
  isOnline: boolean;
  mode: ConnectivityMode;
  networkType: NetworkType;
}

export type ConnectivityListener = (state: ConnectivityState) => void;

class ConnectivityService {
  private mode: ConnectivityMode = 'auto';
  private isOnline: boolean = true;
  private networkType: NetworkType = 'unknown';
  private listeners: Set<ConnectivityListener> = new Set();

  public async verifyConnection(): Promise<boolean> {
    if (this.mode === 'offline') {
      this.updateState(false, 'none');
      return false;
    }

    if (this.mode === 'online') {
      this.updateState(true, 'unknown');
      return true;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch('https://clients3.google.com/generate_204', {
        method: 'GET',
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timeoutId);

      const reachable = !!(response && (response.status === 204 || response.ok));
      this.updateState(reachable, reachable ? 'unknown' : 'none');
      return reachable;
    } catch {
      this.updateState(false, 'none');
      return false;
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
