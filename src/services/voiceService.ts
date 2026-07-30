class VoiceService {
  private muted: boolean = false;
  private lastSpokenText: string = '';

  public speak(instruction: string) {
    if (this.muted || !instruction) {
      return;
    }

    if (instruction === this.lastSpokenText) {
      return;
    }

    this.lastSpokenText = instruction;
    console.log('[Voice Navigation Prompt]:', instruction);
  }

  public stop() {
    if (this.lastSpokenText) {
      console.log('[Voice Navigation]: Stopped');
      this.lastSpokenText = '';
    }
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }
}

export const voiceService = new VoiceService();
