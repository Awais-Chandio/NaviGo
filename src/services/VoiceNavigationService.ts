import { NativeModules } from 'react-native';
import { logger } from '../utils/logger';

interface NativeTextToSpeechModule {
  speak(text: string): void;
  stop?(): void;
}

export class VoiceNavigationService {
  private isMutedState: boolean = false;
  private lastSpokenText: string = '';
  private lastSpokenTime: number = 0;
  private ttsModule: NativeTextToSpeechModule | null = null;

  constructor() {
    try {
      // Lazy attempt to bind react-native-tts if available
      this.ttsModule =
        (NativeModules.TextToSpeech as NativeTextToSpeechModule | undefined) ||
        (NativeModules.Tts as NativeTextToSpeechModule | undefined) ||
        null;
    } catch {
      this.ttsModule = null;
    }
  }

  private isSessionActive: boolean = false;

  public startSession(destinationName: string): void {
    if (this.isSessionActive) return;
    this.isSessionActive = true;
    const initialText = `Starting navigation to ${destinationName}`;
    this.speak(initialText, true);
  }

  public endSession(): void {
    this.isSessionActive = false;
    this.stop();
  }

  public speak(text: string, force: boolean = false): void {
    if (this.isMutedState || !text) return;

    const now = Date.now();
    // Prevent repeating identical text within 4 seconds unless forced
    if (!force && text === this.lastSpokenText && now - this.lastSpokenTime < 4000) {
      return;
    }

    this.lastSpokenText = text;
    this.lastSpokenTime = now;

    logger.info('VoiceNavigation', text);

    if (this.ttsModule && typeof this.ttsModule.speak === 'function') {
      try {
        this.ttsModule.speak(text);
      } catch (err) {
        console.warn('Native TTS speak error:', err);
      }
    }
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
    this.lastSpokenText = '';
    this.lastSpokenTime = 0;
    if (this.ttsModule && typeof this.ttsModule.stop === 'function') {
      try {
        this.ttsModule.stop();
      } catch {
        // silent fallback
      }
    }
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
