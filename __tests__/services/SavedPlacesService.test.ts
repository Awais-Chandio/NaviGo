import { savedPlacesService } from '../../src/services/SavedPlacesService';

describe('SavedPlacesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not fabricate default Home and Work coordinates', async () => {
    const places = await savedPlacesService.getSavedPlaces();
    expect(places).toEqual([]);
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

  it('deletes saved Home without restoring a fabricated location', async () => {
    await savedPlacesService.savePlace({
      id: 'home',
      name: 'Home',
      address: 'User-selected home',
      latitude: 25.4,
      longitude: 68.36,
      type: 'home',
    });
    await savedPlacesService.deletePlace('home');
    const home = await savedPlacesService.getPlaceByType('home');
    expect(home).toBeUndefined();
  });
});
