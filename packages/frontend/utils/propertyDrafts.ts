/**
 * Locally saved listing drafts: the one reader and writer of the AsyncStorage
 * keys the publish flow and `/properties/drafts` share.
 *
 *   `property_drafts`  every saved draft, newest first — what the drafts screen lists
 *
 * A draft is the publish flow's FORM (`CreatePropertyFormData`), the STEP the
 * host had reached, and a summary the drafts screen draws without understanding
 * the form. It never reaches the server: publishing still builds its body from
 * the form with `buildPropertyPayload`, so a resumed draft publishes exactly
 * what the unsaved form would have.
 *
 * ## Two layers, and what each one is for
 *
 * This module is the NAMED, listable layer: a draft is something the host chose
 * to keep and can come back to from `/properties/drafts`. It is written at step
 * transitions and on "Save draft".
 *
 * It is not what survives a crash mid-sentence. That is
 * `createPropertyFormStore`'s `persist` middleware, which writes the live form
 * on every keystroke. The two meet through `step` and `draftId`: the live store
 * restores the session, and the draft it was working on is still the same one,
 * so finishing later replaces that draft rather than adding a twin of it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  type CreatePropertyFormData,
  useCreatePropertyFormStore,
  whenFormRestored,
} from '@/store/createPropertyFormStore';

const DRAFTS_KEY = 'property_drafts';

export interface PropertyDraft {
  id: string;
  title: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  type: string;
  description: string;
  rent: {
    amount: number;
    currency: string;
  };
  images: unknown[];
  lastSaved: Date;
  formData: CreatePropertyFormData;
  /**
   * The wizard step the host had reached, so resuming returns them to it.
   *
   * Optional because drafts saved before this existed have no step; a draft
   * without one resumes at the first step, which is what every draft used to do.
   */
  step?: number;
}

type StoredPropertyDraft = Omit<PropertyDraft, 'lastSaved'> & { lastSaved: string };

export function newDraftId(): string {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function readDrafts(): Promise<PropertyDraft[]> {
  const raw = await AsyncStorage.getItem(DRAFTS_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as StoredPropertyDraft[];
  return parsed.map((draft) => ({ ...draft, lastSaved: new Date(draft.lastSaved) }));
}

async function writeDrafts(drafts: readonly PropertyDraft[]): Promise<void> {
  const stored: StoredPropertyDraft[] = drafts.map((draft) => ({
    ...draft,
    lastSaved: draft.lastSaved.toISOString(),
  }));
  await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(stored));
}

/**
 * Saves the form under `id`, replacing an earlier save of the same draft.
 *
 * `step` is saved with it: a draft that remembers only what was typed sends the
 * host back to step 1 to find their way forward again, which is most of the
 * reason an interrupted listing never gets finished.
 */
export async function saveDraft(
  id: string,
  formData: CreatePropertyFormData,
  step = 0,
): Promise<void> {
  const { basicInfo, location, pricing, media } = formData;
  const draft: PropertyDraft = {
    id,
    title: '',
    address: {
      street: location.address ?? '',
      city: location.city ?? '',
      state: location.state ?? '',
      zipCode: location.postal_code ?? '',
    },
    type: basicInfo.propertyType,
    description: basicInfo.description,
    rent: { amount: pricing.monthlyRent ?? 0, currency: pricing.currency },
    images: media.images ?? [],
    lastSaved: new Date(),
    formData,
    step,
  };
  const others = (await readDrafts()).filter((existing) => existing.id !== id);
  await writeDrafts([draft, ...others]);
}

export async function deleteDraft(id: string): Promise<PropertyDraft[]> {
  const next = (await readDrafts()).filter((draft) => draft.id !== id);
  await writeDrafts(next);
  return next;
}

/**
 * Puts a saved draft in the publish form, at the step it was left on.
 *
 * The drafts screen's "Continue" calls it before opening the flow, so the flow
 * arrives already holding the draft and has nothing to look up. It waits for
 * the form's own restore first, which could otherwise land after the draft and
 * put the previous session back over it. A draft saved before steps were
 * recorded has no step and opens at the first one.
 */
export async function openDraft(draft: PropertyDraft): Promise<void> {
  await whenFormRestored();
  const step = typeof draft.step === 'number' && draft.step > 0 ? Math.floor(draft.step) : 0;
  useCreatePropertyFormStore.getState().loadForm(draft.formData, draft.id, step);
}
