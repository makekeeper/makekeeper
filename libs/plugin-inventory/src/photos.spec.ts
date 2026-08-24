import { MAX_ITEM_PHOTOS, fittingPhotoCount } from './photos';

// The arithmetic behind "these frames will not all fit" (#212 review). It used
// to live inline on the phone's receive screen, where it did not exist at all:
// the whole set was offered to an item that already had pictures, the combined
// list broke the DTO's cap, and the person got a bare save-error while the
// frames attached nowhere and stayed on disk.
describe('fittingPhotoCount', () => {
  it('offers everything to an item with no pictures', () => {
    expect(fittingPhotoCount(0, 3)).toBe(3);
  });

  it('fills exactly to the cap', () => {
    expect(fittingPhotoCount(2, 3)).toBe(3);
    expect(fittingPhotoCount(0, MAX_ITEM_PHOTOS)).toBe(MAX_ITEM_PHOTOS);
  });

  it('offers only the room that is left', () => {
    expect(fittingPhotoCount(3, 3)).toBe(2);
    expect(fittingPhotoCount(4, 5)).toBe(1);
  });

  it('offers nothing to a full item', () => {
    expect(fittingPhotoCount(MAX_ITEM_PHOTOS, 3)).toBe(0);
  });

  // A row saved before the cap existed, or one the cap was later lowered past.
  // "Negative room" is not room.
  it('never goes negative on an item already over the cap', () => {
    expect(fittingPhotoCount(MAX_ITEM_PHOTOS + 2, 3)).toBe(0);
  });

  it('is zero when nothing is offered', () => {
    expect(fittingPhotoCount(0, 0)).toBe(0);
  });
});
