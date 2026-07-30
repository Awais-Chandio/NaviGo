import { savedPlacesService, DEFAULT_HOME_PLACE, DEFAULT_WORK_PLACE } from '../../src/services/SavedPlacesService';

describe('SavedPlacesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('populates default Home and Work places', async () => {
    const places = await savedPlacesService.getSavedPlaces();
    expect(places.length).toBeGreaterThanOrEqual(2);

    const home = await savedPlacesService.getPlaceByType('home');
    expect(home?.name).toBe('Home');
    expect(home?.address).toContain('Prince Town');

    const work = await savedPlacesService.getPlaceByType('work');
    expect(work?.name).toBe('Work');
    expect(work?.address).toContain('Gor Colony');
  });

  it('saves and updates a custom saved place', async () => {
    const customPlace = {
      id: 'test_fav',
      name: 'Favorite Gym',
      address: 'Stadium Rd, Hyderabad',
      latitude: 25.41,
      longitude: 68.36,
      type: 'favorite' as const,
    };

    const updatedList = await savedPlacesService.savePlace(customPlace);
    const found = updatedList.find(p => p.id === 'test_fav');
    expect(found).toBeDefined();
    expect(found?.name).toBe('Favorite Gym');

    // Update place
    const afterUpdate = await savedPlacesService.updatePlace('test_fav', {
      name: 'Mega Fitness Gym',
    });
    const updatedFound = afterUpdate.find(p => p.id === 'test_fav');
    expect(updatedFound?.name).toBe('Mega Fitness Gym');
  });

  it('deletes custom places and resets default home/work if deleted', async () => {
    await savedPlacesService.deletePlace('home');
    const home = await savedPlacesService.getPlaceByType('home');
    expect(home).toBeDefined();
    expect(home?.address).toBe(DEFAULT_HOME_PLACE.address);
  });
});
