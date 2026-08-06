/**
 * `transformAddressFields` — the populated-address detection.
 *
 * This is the guard that decides whether a property's `addressId` gets renamed
 * to `address`. It used to answer that by looking for `_id`, which is a question
 * about how MONGO spells an id rather than a question about the address: the
 * moment a row arrives carrying `id`, the rename silently stops happening and
 * every property card loses its location label with no error anywhere.
 *
 * The cases below pin both directions — the id shapes that must NOT be mistaken
 * for a record, and the record shapes that must be recognised whichever id
 * spelling they carry.
 */

import { Types } from 'mongoose';

import { transformAddressFields } from '../../utils/helpers';

/** A record with only `id` — what a Postgres row looks like once batch 10 lands. */
function joinedAddress(): Record<string, unknown> {
  return { id: 'a'.repeat(24), street: 'Carrer de Test', cityName: 'Barcelona' };
}

/** A record with only `_id` — what a Mongo populate produces today. */
function populatedAddress(): Record<string, unknown> {
  return { _id: new Types.ObjectId(), street: 'Carrer de Test', cityName: 'Barcelona' };
}

describe('transformAddressFields', () => {
  it('renames an address carrying only `id` — the case the old `_id` guard missed', () => {
    const property: Record<string, unknown> = { addressId: joinedAddress() };

    transformAddressFields(property);

    expect(property.address).toEqual(expect.objectContaining({ street: 'Carrer de Test' }));
    expect(property.addressId).toBeUndefined();
  });

  it('still renames a Mongo-populated address carrying only `_id`', () => {
    const property: Record<string, unknown> = { addressId: populatedAddress() };

    transformAddressFields(property);

    expect(property.address).toEqual(expect.objectContaining({ street: 'Carrer de Test' }));
    expect(property.addressId).toBeUndefined();
  });

  it('leaves an UNPOPULATED ObjectId ref alone', () => {
    const ref = new Types.ObjectId();
    const property: Record<string, unknown> = { addressId: ref };

    transformAddressFields(property);

    expect(property.address).toBeUndefined();
    expect(property.addressId).toBe(ref);
  });

  it('leaves a bare id STRING alone', () => {
    const property: Record<string, unknown> = { addressId: 'a'.repeat(24) };

    transformAddressFields(property);

    expect(property.address).toBeUndefined();
    expect(property.addressId).toBe('a'.repeat(24));
  });

  it('leaves a uuid v7 string alone — the shape every post-cutover row carries', () => {
    const property: Record<string, unknown> = { addressId: '01997f2c-6b40-7000-8000-0000000000ab' };

    transformAddressFields(property);

    expect(property.address).toBeUndefined();
  });

  it('strips `showAddressNumber` off the address, which belongs at property level', () => {
    const property: Record<string, unknown> = {
      addressId: { ...joinedAddress(), showAddressNumber: true },
    };

    transformAddressFields(property);

    expect(property.address).toBeDefined();
    expect((property.address as Record<string, unknown>).showAddressNumber).toBeUndefined();
  });

  it('does nothing when there is no addressId at all', () => {
    const property: Record<string, unknown> = { type: 'apartment' };

    transformAddressFields(property);

    expect(property.address).toBeUndefined();
  });
});
