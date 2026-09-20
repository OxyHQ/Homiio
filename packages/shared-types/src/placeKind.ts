/**
 * "A whole place" or "a room in one" — the question Bloom's Stays template asks
 * first, answered from the property types Homiio already has (#518 §6).
 *
 * ## Why this is a VIEW over `propertyTypes`, not a column
 *
 * Homiio records what a listing IS (`apartment`, `room`, `coliving`, …). Whether
 * that counts as a whole place is derivable from it, so a column would be a
 * second recording of one fact — and the copy is the one that goes stale when
 * somebody adds a type and updates only the enum.
 *
 * It also keeps the two controls honest about each other. The filters dialog
 * shows this segment above the type tiles, and because the segment is a
 * PROJECTION of the same field, picking "a room" visibly ticks the room types
 * below it. Two controls writing two fields that mean the same thing is how a
 * screen comes to contradict itself.
 *
 * ## The classification, and what it deliberately leaves out
 *
 * A whole place is self-contained: you close your own front door.
 * A room is a room inside somebody else's home or a shared one.
 *
 * Seven of Homiio's types are NEITHER, and forcing them into one side would be
 * the invention this file exists to avoid. A hostel bed, a couch, a campsite, a
 * boat, a treehouse and a yurt are answers to "what kind of stay is this", not
 * to "do I get the whole place". `other` is by definition unclassifiable. They
 * are reachable through the type tiles, and a search that names neither side of
 * the segment still returns them.
 */

import { PropertyType } from './common';

/** Self-contained dwellings: your own front door. */
export const WHOLE_HOME_PROPERTY_TYPES: readonly PropertyType[] = [
  PropertyType.APARTMENT,
  PropertyType.HOUSE,
  PropertyType.STUDIO,
];

/**
 * A room inside a larger home.
 *
 * `roommates` and `coliving` belong here rather than with whole homes: both
 * advertise a room and a shared kitchen, which is the fact somebody choosing
 * between the two sides of this control is choosing on.
 */
export const ROOM_PROPERTY_TYPES: readonly PropertyType[] = [
  PropertyType.ROOM,
  PropertyType.ROOMMATES,
  PropertyType.COLIVING,
];

/** The three states the segment can be in. `any` is "the question is not being asked". */
export const PLACE_KINDS = ['any', 'whole_home', 'room'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** The types one side of the segment selects, or none at all for `any`. */
export function propertyTypesForPlaceKind(kind: PlaceKind): readonly PropertyType[] {
  if (kind === 'whole_home') return WHOLE_HOME_PROPERTY_TYPES;
  if (kind === 'room') return ROOM_PROPERTY_TYPES;
  return [];
}

/**
 * Which side of the segment a type selection represents, if any.
 *
 * `any` unless the selection is EXACTLY one side's set. That strictness is the
 * point: somebody who ticked `apartment` and `room` in the tiles has not asked
 * this question, and showing "whole place" highlighted because one of its three
 * types happens to be selected would be the control lying about the search it
 * is sitting over.
 *
 * Order-insensitive and duplicate-tolerant, because a selection arrives from a
 * URL as often as from a tap.
 */
export function placeKindOf(types: readonly PropertyType[]): PlaceKind {
  const selected = new Set(types);
  if (selected.size === 0) return 'any';
  if (matchesExactly(selected, WHOLE_HOME_PROPERTY_TYPES)) return 'whole_home';
  if (matchesExactly(selected, ROOM_PROPERTY_TYPES)) return 'room';
  return 'any';
}

function matchesExactly(selected: ReadonlySet<PropertyType>, side: readonly PropertyType[]): boolean {
  return selected.size === side.length && side.every((type) => selected.has(type));
}
