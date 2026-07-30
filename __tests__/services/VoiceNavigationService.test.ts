import voiceNavigationService from '../../src/services/VoiceNavigationService';

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
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    voiceNavigationService.speakManeuverPrompt('Turn left onto Main St', 250);
    expect(spy).toHaveBeenCalledWith('[Voice Navigation]:', expect.stringContaining('300 meters'));
    spy.mockRestore();
  });
});
