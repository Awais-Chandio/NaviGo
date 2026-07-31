import Tts from 'react-native-tts';
import { logger } from '../utils/logger';

export class VoiceNavigationService {
  private isMutedState = false;
  private lastSpokenText = '';
  private isSessionActive = false;
  private isReady = false;
  private initializationFailed = false;
  private pendingText: string | null = null;
  private readonly initializationPromise: Promise<boolean>;

  constructor() {
    this.initializationPromise = this.initialize();
  }

  private async initialize(): Promise<boolean> {
    try {
      await Tts.getInitStatus();
      this.isReady = true;
      logger.info(
        'VoiceNavigation',
        'Native text-to-speech initialized successfully.',
      );

      Tts.setDucking(true).catch(error => {
        logger.warn('VoiceNavigation', 'Unable to enable TTS ducking.', error);
      });
      Tts.setDefaultLanguage('en-PK').catch(error => {
        logger.warn(
          'VoiceNavigation',
          'The preferred en-PK TTS voice is unavailable; using the device default.',
          error,
        );
      });

      const pendingText = this.pendingText;
      this.pendingText = null;
      if (pendingText && !this.isMutedState) {
        this.performSpeak(pendingText);
      }
      return true;
    } catch (error) {
      this.initializationFailed = true;
      this.pendingText = null;
      logger.warn(
        'VoiceNavigation',
        'Native text-to-speech is unavailable on this device.',
        error,
      );
      return false;
    }
  }

  private performSpeak(text: string): void {
    try {
      Tts.speak(text, {
        androidParams: {
          KEY_PARAM_STREAM: 'STREAM_MUSIC',
          KEY_PARAM_VOLUME: 1,
          KEY_PARAM_PAN: 0,
        },
      } as Parameters<typeof Tts.speak>[1]);
    } catch (error) {
      logger.warn('VoiceNavigation', 'Native TTS speak failed.', error);
    }
  }

  public startSession(destinationName: string): void {
    if (this.isSessionActive) return;
    this.isSessionActive = true;
    this.speak(`Starting navigation to ${destinationName}`, true);
  }

  public endSession(): void {
    this.isSessionActive = false;
    this.stop();
  }

  public speak(text: string, force = false): void {
    if (this.isMutedState || !text) return;
    if (!force && text === this.lastSpokenText) return;

    this.lastSpokenText = text;
    logger.info('VoiceNavigation', text);

    if (this.isReady) {
      this.performSpeak(text);
    } else if (!this.initializationFailed) {
      // Keep only the newest instruction while the native engine starts. This
      // avoids playing stale maneuver prompts after initialization completes.
      this.pendingText = text;
    }
  }

  public isAvailable(): boolean {
    return !this.initializationFailed;
  }

  public speakManeuverPrompt(
    instruction: string,
    distanceMeters: number,
  ): void {
    if (this.isMutedState) return;

    let textToSpeak = instruction;
    if (distanceMeters > 300 && distanceMeters <= 500) {
      textToSpeak = `In 500 meters, ${instruction.toLowerCase()}`;
    } else if (distanceMeters > 150 && distanceMeters <= 300) {
      textToSpeak = `In 300 meters, ${instruction.toLowerCase()}`;
    } else if (distanceMeters > 40 && distanceMeters <= 150) {
      textToSpeak = `In 100 meters, ${instruction.toLowerCase()}`;
    } else if (distanceMeters <= 20) {
      textToSpeak = instruction;
    }

    this.speak(textToSpeak);
  }

  public stop(): void {
    this.pendingText = null;
    this.lastSpokenText = '';
    Tts.stop().catch(error => {
      logger.warn('VoiceNavigation', 'Unable to stop native TTS.', error);
    });
  }

  public setMuted(muted: boolean): boolean {
    this.isMutedState = muted;
    if (muted) {
      this.stop();
    }
    return this.isMutedState;
  }

  public toggleMute(): boolean {
    return this.setMuted(!this.isMutedState);
  }

  public isMuted(): boolean {
    return this.isMutedState;
  }
}

export const voiceNavigationService = new VoiceNavigationService();
export default voiceNavigationService;
