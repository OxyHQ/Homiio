/**
 * The device's position, for a map that has nothing of its own to frame — only
 * ever one the reader ALREADY granted. It is read (`useUserCoordinates`), never
 * asked for: opening a map is not a request for a location (#518 §12).
 *
 * It is LATCHED at the first fix. `MapView` follows its `camera` by value, and
 * `useUserCoordinates` refetches once its fix has aged; following the live
 * value would move the map, minutes later, under a reader who has panned.
 */
import { useState } from 'react';
import type { GeoCoordinate } from '@goway.to/maps';

import { useUserCoordinates } from '@/hooks/useHomeFeed';

export function useOpeningFix(): GeoCoordinate | null {
  const { data: fix } = useUserCoordinates();
  const [opening, setOpening] = useState<GeoCoordinate | null>(null);
  if (opening === null && fix) setOpening(fix);
  return opening;
}
