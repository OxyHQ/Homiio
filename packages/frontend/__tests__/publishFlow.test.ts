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
import {
  CREATE_PROPERTY_FORM_PERSIST_KEY,
  createDefaultFormData,
  useCreatePropertyFormStore,
} from '@/store/createPropertyFormStore';
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

  it('resumes at the step the draft was left on, not at step one', async () => {
    await saveDraft('draft-b', createDefaultFormData(), 5);
    const [draft] = await readDrafts();
    expect(draft.step).toBe(5);

    await markDraftForResume(draft);
    expect((await takeDraftToResume())?.step).toBe(5);
  });

  it('resumes a draft saved before steps were recorded at the first step', async () => {
    // Written the way `saveDraft` used to write it: no `step` at all.
    await AsyncStorage.setItem(
      'property_drafts',
      JSON.stringify([
        {
          id: 'draft-old',
          title: '',
          address: { street: '', city: '', state: '', zipCode: '' },
          type: '',
          description: '',
          rent: { amount: 0, currency: 'USD' },
          images: [],
          lastSaved: new Date('2026-01-01').toISOString(),
          formData: createDefaultFormData(),
        },
      ]),
    );
    const [draft] = await readDrafts();
    await markDraftForResume(draft);
    expect((await takeDraftToResume())?.step).toBe(0);
  });
});

/**
 * The live form, which is what an INTERRUPTION loses.
 *
 * The drafts above are written on step transitions — the one moment the current
 * step's work is already behind you. What somebody is typing right now is only
 * protected by the store persisting itself, so these assert against the storage
 * the store actually writes and the restore it actually performs.
 */
describe('the live publish form across a restart', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useCreatePropertyFormStore.getState().resetForm();
  });

  /** Let zustand's persist middleware flush its write. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function typeSomething() {
    const store = useCreatePropertyFormStore.getState();
    store.setFormData('basicInfo', { description: 'A quiet flat over the square,' });
    store.setCurrentStep(4);
    store.setDraftId('draft-live');
    await settle();
  }

  it('writes the form, the step and the draft it belongs to — and nothing transient', async () => {
    await typeSomething();

    const raw = await AsyncStorage.getItem(CREATE_PROPERTY_FORM_PERSIST_KEY);
    expect(raw).not.toBeNull();
    const { state } = JSON.parse(raw as string);
    expect(state.formData.basicInfo.description).toBe('A quiet flat over the square,');
    expect(state.currentStep).toBe(4);
    expect(state.draftId).toBe('draft-live');
    // A spinner and an error belong to a request that is long over by the time
    // the app starts again; restoring either would show something unstoppable.
    expect(state).not.toHaveProperty('isLoading');
    expect(state).not.toHaveProperty('error');
  });

  it('restores what was typed AND where the host was', async () => {
    await typeSomething();
    const stored = (await AsyncStorage.getItem(CREATE_PROPERTY_FORM_PERSIST_KEY)) as string;

    // The process dies: memory is back to defaults, storage is untouched. (The
    // reset itself persists, so the saved blob is put back before the restore —
    // a relaunch does not overwrite storage on its way up.)
    useCreatePropertyFormStore.getState().resetForm();
    useCreatePropertyFormStore.setState({ hasHydrated: false });
    await settle();
    await AsyncStorage.setItem(CREATE_PROPERTY_FORM_PERSIST_KEY, stored);

    await useCreatePropertyFormStore.persist.rehydrate();

    const restored = useCreatePropertyFormStore.getState();
    expect(restored.formData.basicInfo.description).toBe('A quiet flat over the square,');
    expect(restored.currentStep).toBe(4);
    // Same draft, so finishing later replaces it instead of leaving a twin.
    expect(restored.draftId).toBe('draft-live');
    expect(restored.hasHydrated).toBe(true);
  });

  it('loads a resumed draft at its own step', () => {
    const form = createDefaultFormData();
    form.basicInfo.description = 'From the drafts screen';
    useCreatePropertyFormStore.getState().loadForm(form, 'draft-c', 3);

    const state = useCreatePropertyFormStore.getState();
    expect(state.currentStep).toBe(3);
    expect(state.draftId).toBe('draft-c');
    expect(state.formData.basicInfo.description).toBe('From the drafts screen');
  });
});
