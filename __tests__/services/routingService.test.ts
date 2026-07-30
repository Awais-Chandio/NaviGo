import { parseOSRMSteps } from '../../src/services/routingService';

describe('routingService', () => {
  test('parseOSRMSteps converts raw OSRM steps into user instructions', () => {
    const rawSteps: any[] = [
      {
        distance: 120,
        duration: 15,
        name: 'Shahrah-e-Faisal',
        maneuver: { type: 'depart', modifier: 'right' },
      },
      {
        distance: 450,
        duration: 40,
        name: 'Main Boulevard',
        maneuver: { type: 'turn', modifier: 'right' },
      },
      {
        distance: 0,
        duration: 0,
        maneuver: { type: 'arrive' },
      },
    ];

    const parsed = parseOSRMSteps(rawSteps);
    expect(parsed.length).toBe(3);
    expect(parsed[0].instruction).toContain('Start navigation');
    expect(parsed[1].instruction).toBe('Turn right onto Main Boulevard');
    expect(parsed[2].instruction).toBe('You have arrived at your destination');
  });
});
