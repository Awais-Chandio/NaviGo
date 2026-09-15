import {
  calculateRankingScore,
  calculateTextMatchScore,
  isBrandedPlace,
  hasCompleteMetadata,
} from '../../src/utils/rankingUtils';

describe('rankingUtils', () => {
  it('matches autocomplete characters at the start of any title word', () => {
    expect(calculateTextMatchScore('The Grill Town', 'Hyderabad', 'Gri')).toBeGreaterThan(0);
    expect(calculateTextMatchScore('Grocery Market', 'Hyderabad', 'Gri')).toBe(0);
    expect(calculateTextMatchScore('Grill Town', 'Hyderabad', 'gri to')).toBeGreaterThan(0);
  });

  it('rejects a result when a typed word does not match', () => {
    expect(calculateTextMatchScore('Grill Town', 'Hyderabad', 'grill pizza')).toBe(0);
  });

  it('identifies branded places accurately', () => {
    expect(isBrandedPlace('Shell Petrol Pump')).toBe(false);
    expect(isBrandedPlace('McDonalds Fast Food')).toBe(false);
    expect(isBrandedPlace('HBL ATM')).toBe(false);
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

  it('does not let a generic title prefix outrank a materially closer match', () => {
    const userLocation = { latitude: 25.396, longitude: 68.3578 };
    const nearbyHospital = calculateRankingScore({
      title: 'Civil Hospital Hyderabad',
      subtitle: 'Hospital Road, Hyderabad',
      latitude: 25.4054,
      longitude: 68.361,
      userLocation,
      query: 'hospital',
    });
    const fartherParking = calculateRankingScore({
      title: 'Hospital Parking',
      subtitle: 'Jamshoro Road, Hyderabad',
      latitude: 25.413,
      longitude: 68.362,
      userLocation,
      query: 'hospital',
    });

    expect(nearbyHospital).toBeGreaterThan(fartherParking);
  });

  it('uses real importance and structured category relevance without inventing defaults', () => {
    const base = {
      title: 'Local Place',
      latitude: 25.396,
      longitude: 68.3578,
    };
    const noProviderImportance = calculateRankingScore(base);
    const realProviderImportance = calculateRankingScore({
      ...base,
      importance: 0.8,
    });
    const categoryMatch = calculateRankingScore({
      ...base,
      categoryMatched: true,
    });

    expect(realProviderImportance - noProviderImportance).toBe(40);
    expect(categoryMatch - noProviderImportance).toBe(250);
  });
});
