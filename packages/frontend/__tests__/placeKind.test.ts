/**
 * "A whole place" or "a room in one" (#518 §6).
 *
 * The segment is a PROJECTION of `propertyTypes`, not a second field, so the
 * only thing that can go wrong is the projection disagreeing with the tiles
 * underneath it. These pin both directions of that round trip, and the case
 * that matters most is the one in the middle: a selection that is neither side
 * must read as `any`, or the control lights up a choice nobody made.
 */

import {
  PLACE_KINDS,
  PropertyType,
  ROOM_PROPERTY_TYPES,
  WHOLE_HOME_PROPERTY_TYPES,
  placeKindOf,
  propertyTypesForPlaceKind,
} from '@homiio/shared-types';

describe('reading a selection as a side of the segment', () => {
  it('round-trips each side', () => {
    for (const kind of PLACE_KINDS) {
      expect(placeKindOf([...propertyTypesForPlaceKind(kind)])).toBe(kind);
    }
  });

  it('reads no selection as the question not being asked', () => {
    expect(placeKindOf([])).toBe('any');
    expect(propertyTypesForPlaceKind('any')).toEqual([]);
  });

  it('reads a MIXED selection as `any`, not as the side it overlaps', () => {
    // Somebody who ticked an apartment and a room in the tiles has not answered
    // this question. Highlighting "whole place" because one of its three types
    // is selected would be the control describing a search that is not running.
    expect(placeKindOf([PropertyType.APARTMENT, PropertyType.ROOM])).toBe('any');
    expect(placeKindOf([PropertyType.APARTMENT])).toBe('any');
    expect(placeKindOf([...WHOLE_HOME_PROPERTY_TYPES, PropertyType.HOSTEL])).toBe('any');
  });

  it('ignores order and duplicates, because a selection arrives from a URL too', () => {
    const shuffled = [...ROOM_PROPERTY_TYPES].reverse();
    expect(placeKindOf(shuffled)).toBe('room');
    expect(placeKindOf([...ROOM_PROPERTY_TYPES, ...ROOM_PROPERTY_TYPES])).toBe('room');
  });
});

describe('the classification itself', () => {
  it('puts a room in a shared home on the room side, not the whole-home side', () => {
    // `roommates` and `coliving` both advertise a room and a shared kitchen,
    // which is the fact somebody choosing between the two sides is choosing on.
    expect(ROOM_PROPERTY_TYPES).toEqual(
      expect.arrayContaining([PropertyType.ROOM, PropertyType.ROOMMATES, PropertyType.COLIVING]),
    );
    expect(WHOLE_HOME_PROPERTY_TYPES).not.toContain(PropertyType.COLIVING);
  });

  it('leaves the stay types out of BOTH sides', () => {
    // A hostel bed, a couch, a campsite, a boat, a treehouse and a yurt answer
    // "what kind of stay is this", not "do I get the whole place". Forcing them
    // onto a side would be an invention; they stay reachable through the tiles.
    const classified = new Set([...WHOLE_HOME_PROPERTY_TYPES, ...ROOM_PROPERTY_TYPES]);
    for (const unclassified of [
      PropertyType.HOSTEL,
      PropertyType.COUCHSURFING,
      PropertyType.CAMPSITE,
      PropertyType.BOAT,
      PropertyType.TREEHOUSE,
      PropertyType.YURT,
      PropertyType.GUESTHOUSE,
      PropertyType.OTHER,
    ]) {
      expect(classified.has(unclassified)).toBe(false);
    }
  });

  it('never puts one type on both sides', () => {
    for (const type of WHOLE_HOME_PROPERTY_TYPES) {
      expect(ROOM_PROPERTY_TYPES).not.toContain(type);
    }
  });
});
