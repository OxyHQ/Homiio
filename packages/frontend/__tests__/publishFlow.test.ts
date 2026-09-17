/**
 * The publish flow on Bloom's `wizard` / `listing-editor`: the step order, what
 * the live preview is allowed to say, where the quality checklist sends the
 * host, and the local drafts the flow saves and resumes.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TFunction } from 'i18next';
import { OfferingType } from '@homiio/shared-types';

import {
  STEP_COPY,
  STEP_EXCHANGE_SETTINGS,
  STEP_LONG_TERM_PRICING,
  STEP_SALE_DETAILS,
  resolveStepFlow,
} from '@/components/property/create/constants';
import {
  draftPreviewData,
  draftQualityItems,
} from '@/components/property/create/listingDraft';
import { createDefaultFormData } from '@/store/createPropertyFormStore';
import {
  deleteDraft,
  markDraftForResume,
  readDrafts,
  saveDraft,
  takeDraftToResume,
} from '@/utils/propertyDrafts';

/** Echoes the key and its options, so assertions read what was asked for. */
const t = ((key: string, options?: Record<string, unknown>) =>
  options && 'count' in options ? `${key}:${options.count}` : key) as unknown as TFunction;

const formatting = {
  locale: 'en-US',
  priceUnitLabels: {
    month: { short: 'month', spoken: 'per month' },
    night: { short: 'night', spoken: 'per night' },
  },
  areaUnitLabels: { sqm: { short: 'm²', spoken: 'square metres' } },
} as never;

describe('resolveStepFlow', () => {
  it('follows the housing template order and inserts one step per offering', () => {
    expect(
      resolveStepFlow('apartment', [OfferingType.LONG_TERM_RENT, OfferingType.SALE, OfferingType.EXCHANGE]),
    ).toEqual([
      'Property Type',
      'Location',
      'Basic Info',
      'Offering',
      STEP_LONG_TERM_PRICING,
      STEP_SALE_DETAILS,
      STEP_EXCHANGE_SETTINGS,
      'Amenities',
      'Media',
      'Description',
      'Preview',
    ]);
    expect(resolveStepFlow('other', [])).not.toContain('Amenities');
    expect(resolveStepFlow('coliving', [])).toContain('Coliving Features');
  });

  it('has copy for every step any flow can reach', () => {
    const all = new Set(
      ['apartment', 'house', 'room', 'studio', 'coliving', 'other'].flatMap((type) =>
        resolveStepFlow(type, Object.values(OfferingType)),
      ),
    );
    for (const step of all) expect(STEP_COPY[step]).toBeDefined();
  });
});

describe('draftPreviewData', () => {
  it('draws the floor as a fact only when the host published it', () => {
    const form = createDefaultFormData();
    form.basicInfo.propertyType = 'apartment';
    form.location = { ...form.location, floor: 7, unit: '7-1', showFloor: false };
    expect(draftPreviewData(form, t, formatting).dates ?? '').not.toContain('property.sections.floor');

    form.location.showFloor = true;
    const published = draftPreviewData(form, t, formatting);
    expect(published.dates).toContain('property.sections.floor 7');
    // Public floor or not, the card never draws the door.
    expect(JSON.stringify(published)).not.toContain('7-1');
  });

  it('draws the city line, never the number, floor or unit', () => {
    const form = createDefaultFormData();
    form.basicInfo.propertyType = 'apartment';
    form.location = {
      ...form.location,
      address: 'Carrer de Verdi',
      number: '14',
      unit: '3-2',
      floor: 3,
      city: 'Barcelona',
      state: 'Catalonia',
    };
    const preview = draftPreviewData(form, t, formatting);
    expect(preview.subtitle).toBe('Barcelona, Catalonia');
    const drawn = JSON.stringify(preview);
    expect(drawn).not.toContain('14');
    expect(drawn).not.toContain('3-2');
    expect(preview.rating).toBeUndefined();
    expect(preview.badge).toBeUndefined();
  });

  it('draws one price line per priced offering and the offerings as badges', () => {
    const form = createDefaultFormData();
    form.pricing = {
      ...form.pricing,
      offerings: [OfferingType.LONG_TERM_RENT, OfferingType.EXCHANGE],
      currency: 'EUR',
      monthlyRent: 1450,
    };
    const preview = draftPreviewData(form, t, formatting);
    expect(preview.offerings).toEqual(['long_term_rent', 'exchange']);
    expect(preview.priceLines).toHaveLength(2);
    expect(preview.priceLines?.[0].unit).toBe('month');
    expect(preview.priceLines?.[1].price).toBe('listing.exchange.free');
  });
});

describe('draftQualityItems', () => {
  it('sends an unfinished row to the step that fixes it, and a done row nowhere', () => {
    const form = createDefaultFormData();
    form.basicInfo.propertyType = 'apartment';
    const steps = resolveStepFlow('apartment', form.pricing.offerings);
    const goTo = jest.fn();
    const items = draftQualityItems(form, steps, goTo, t);

    const pricing = items.find((item) => item.key === 'pricing');
    expect(pricing?.done).toBe(false);
    pricing?.onPress?.();
    expect(goTo).toHaveBeenCalledWith(STEP_LONG_TERM_PRICING);

    const type = items.find((item) => item.key === 'type');
    expect(type?.done).toBe(true);
    expect(type?.onPress).toBeUndefined();

    // The Barcelona default is not a pinned location.
    expect(items.find((item) => item.key === 'location')?.done).toBe(false);
  });
});

describe('property drafts', () => {
  beforeEach(() => AsyncStorage.clear());

  it('saves over the same draft, resumes it once and deletes it', async () => {
    const form = createDefaultFormData();
    form.basicInfo.propertyType = 'house';
    await saveDraft('draft-a', form);
    form.basicInfo.description = 'Second save';
    await saveDraft('draft-a', form);

    const drafts = await readDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].formData.basicInfo.description).toBe('Second save');
    expect(drafts[0].lastSaved).toBeInstanceOf(Date);

    await markDraftForResume(drafts[0]);
    const resumed = await takeDraftToResume();
    expect(resumed?.id).toBe('draft-a');
    expect(resumed?.formData.basicInfo.propertyType).toBe('house');
    expect(await takeDraftToResume()).toBeNull();

    expect(await deleteDraft('draft-a')).toEqual([]);
  });
});
