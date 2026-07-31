import { calculateRankingScore, isBrandedPlace, hasCompleteMetadata } from '../../src/utils/rankingUtils';

describe('rankingUtils', () => {
  it('identifies branded places accurately', () => {
    expect(isBrandedPlace('Shell Petrol Pump')).toBe(true);
    expect(isBrandedPlace('McDonalds Fast Food')).toBe(true);
    expect(isBrandedPlace('HBL ATM')).toBe(true);
    expect(isBrandedPlace('Local Corner Shop')).toBe(false);
    expect(isBrandedPlace('Random Spot', undefined, { brand: 'PSO' })).toBe(true);
  });

  it('evaluates metadata completeness correctly', () => {
    expect(hasCompleteMetadata('Main Street, Downtown, City')).toBe(true);
    expect(hasCompleteMetadata(undefined, { road: 'Main St', city: 'Karachi' })).toBe(true);
    expect(hasCompleteMetadata('SingleWord')).toBe(false);
  });

  it('calculates composite ranking score prioritizing close, branded, matching places', () => {
    const userLocation = { latitude: 25.396, longitude: 68.3578 };

    const scoreCloseBranded = calculateRankingScore({
      title: 'Shell Petrol Station',
      subtitle: 'Main Highway, City',
      latitude: 25.397,
      longitude: 68.358,
      userLocation,
      query: 'Shell',
      importance: 0.8,
    });

    const scoreFarGeneric = calculateRankingScore({
      title: 'Fuel Spot',
      subtitle: 'Remote Area',
      latitude: 25.480,
      longitude: 68.450,
      userLocation,
      query: 'Shell',
      importance: 0.2,
    });

    expect(scoreCloseBranded).toBeGreaterThan(scoreFarGeneric);
  });

  it('keeps the live user location ahead of the Hyderabad regional preference', () => {
    const karachiUser = { latitude: 24.8607, longitude: 67.0011 };
    const nearbyKarachi = calculateRankingScore({
      title: 'Local Hospital',
      latitude: 24.861,
      longitude: 67.002,
      userLocation: karachiUser,
      query: 'hospital',
    });
    const hyderabadResult = calculateRankingScore({
      title: 'Hyderabad Hospital',
      latitude: 25.396,
      longitude: 68.3578,
      userLocation: karachiUser,
      query: 'hospital',
    });

    expect(nearbyKarachi).toBeGreaterThan(hyderabadResult);
  });
});
