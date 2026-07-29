/**
 * Voice Navigation Service.
 * Provides text-to-speech navigation guidance interface.
 * Can be connected to react-native-tts or native TTS engines.
 */

class VoiceService {
  private muted: boolean = false;
  private lastSpokenText: string = '';

  /**
   * Speaks a turn-by-turn navigation prompt.
   * Prevents repeating identical consecutive prompts.
   */
  public speak(instruction: string) {
    if (this.muted || !instruction) {
      return;
    }

    if (instruction === this.lastSpokenText) {
      return;
    }

    this.lastSpokenText = instruction;
    console.log('[Voice Navigation Prompt]:', instruction);

    // Drop-in integration point for react-native-tts:
    // Tts.stop();
    // Tts.speak(instruction);
  }

  public stop() {
    if (this.lastSpokenText) {
      console.log('[Voice Navigation]: Stopped');
      this.lastSpokenText = '';
    }
    // Tts.stop();
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }
}

export const voiceService = new VoiceService();
