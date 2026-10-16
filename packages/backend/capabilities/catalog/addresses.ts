import type { CatalogTool } from '@oxy.so/contracts';

import {
  actTool,
  idInput,
  limitInput,
  objectInput,
  openObjectInput,
  optionalTextInput,
  pageInput,
  readTool,
  textInput,
} from './define';

const identityString = { type: ['string', 'null'], maxLength: 300 } as const;
const attributeString = { type: ['string', 'null'], maxLength: 500 } as const;

export const ADDRESS_TOOLS: readonly CatalogTool[] = [
  readTool({
    name: 'searchAddresses',
    description:
      'Search canonical addresses whose street matches the text or whose city, region or neighbourhood it names, newest first. Published at building precision (no floor or door).',
    capability: 'housing.addresses.read',
    input: objectInput({ query: textInput(200), page: pageInput, limit: limitInput }, ['query']),
  }),
  readTool({
    name: 'findNearbyAddresses',
    description:
      'Find canonical addresses within a radius (metres, default 1000) of a point, nearest first, at building precision.',
    capability: 'housing.addresses.read',
    input: objectInput(
      {
        lat: { type: 'number', minimum: -90, maximum: 90 },
        lng: { type: 'number', minimum: -180, maximum: 180 },
        radius: { type: 'integer', minimum: 1, maximum: 50_000 },
        limit: limitInput,
      },
      ['lat', 'lng'],
    ),
  }),
  readTool({
    name: 'getAddress',
    description:
      'Read one canonical address. It is published at building precision unless the person has a recorded relation to the place, exactly as the app shows it to them.',
    capability: 'housing.addresses.read',
    input: objectInput({ addressId: idInput }, ['addressId']),
  }),
  actTool({
    name: 'createAddress',
    description:
      'Resolve the canonical address for a described place (deduplicated: an existing place is returned, not copied). Needs street, city, country and coordinates; returns its id to attach a listing or a review to.',
    capability: 'housing.addresses.manage',
    capabilityPackage: 'create',
    input: objectInput(
      {
        address: openObjectInput(
          'street, number, building_name, floor, unit, postal_code, city, state, country, countryCode, neighborhood, and coordinates as { type: "Point", coordinates: [lng, lat] }.',
        ),
      },
      ['address'],
    ),
  }),
  actTool({
    name: 'updateAddress',
    description:
      'Correct the non-identity attributes (district, po_box, reference) of a place the person has a recorded relation to; otherwise not-found. Identity fields (street, number, floor…) are refused — propose them with proposeAddressCorrection.',
    capability: 'housing.addresses.manage',
    capabilityPackage: 'administer',
    input: objectInput(
      {
        addressId: idInput,
        district: attributeString,
        po_box: attributeString,
        reference: attributeString,
      },
      ['addressId'],
    ),
  }),
  readTool({
    name: 'listAddressCorrections',
    description:
      'List the open identity corrections proposed against a place, at the person’s own precision.',
    capability: 'housing.addresses.read',
    input: objectInput({ addressId: idInput }, ['addressId']),
  }),
  actTool({
    name: 'proposeAddressCorrection',
    description:
      'Propose a correction to a place’s identity (street, number, building_name, block, entrance, floor, unit, subunit) with a reason. It changes nothing by itself; the community resolves it.',
    capability: 'housing.addresses.corrections',
    capabilityPackage: 'publish',
    input: objectInput(
      {
        addressId: idInput,
        reason: textInput(500),
        evidenceUrl: optionalTextInput(2000),
        street: identityString,
        number: identityString,
        building_name: identityString,
        block: identityString,
        entrance: identityString,
        floor: identityString,
        unit: identityString,
        subunit: identityString,
      },
      ['addressId', 'reason'],
    ),
  }),
  actTool({
    name: 'withdrawAddressCorrection',
    description:
      'Withdraw a correction the person proposed. Somebody else’s proposal answers not-found.',
    capability: 'housing.addresses.corrections',
    capabilityPackage: 'administer',
    input: objectInput({ addressId: idInput, proposalId: idInput }, ['addressId', 'proposalId']),
  }),
];
