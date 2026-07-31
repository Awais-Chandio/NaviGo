import voiceNavigationService from '../../src/services/VoiceNavigationService';
import Tts from 'react-native-tts';

describe('VoiceNavigationService', () => {
  beforeEach(() => {
    voiceNavigationService.setMuted(false);
  });

  it('toggles mute state correctly', () => {
    expect(voiceNavigationService.isMuted()).toBe(false);
    const muted = voiceNavigationService.toggleMute();
    expect(muted).toBe(true);
    expect(voiceNavigationService.isMuted()).toBe(true);
  });

  it('handles distance maneuver prompts', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
    voiceNavigationService.speakManeuverPrompt('Turn left onto Main St', 250);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('300 meters'));
    voiceNavigationService.speakManeuverPrompt('Turn left onto Main St', 250);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('uses the initialized native TTS engine', async () => {
    await Promise.resolve();
    voiceNavigationService.speak('Continue straight', true);
    expect(Tts.speak).toHaveBeenCalledWith(
      'Continue straight',
      expect.objectContaining({
        androidParams: expect.objectContaining({
          KEY_PARAM_STREAM: 'STREAM_MUSIC',
        }),
      }),
    );
  });
});
