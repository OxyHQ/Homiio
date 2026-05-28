/**
 * AmenitiesSection — thin wrapper around the shared `AmenitiesGrid` so
 * existing callers on `/properties/[id]` keep working while the visual
 * implementation now matches the Airbnb-2026 "What this place offers"
 * grid pattern.
 */
import React from 'react';

import { AmenitiesGrid } from './AmenitiesGrid';

interface Props {
  property: { amenities?: string[] | null };
}

export const AmenitiesSection: React.FC<Props> = ({ property }) => {
  return <AmenitiesGrid property={property} />;
};

export default AmenitiesSection;
