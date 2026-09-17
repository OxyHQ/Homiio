/**
 * Locally saved listing drafts: the one reader and writer of the AsyncStorage
 * keys the publish flow and `/properties/drafts` share.
 *
 *   `property_drafts`  every saved draft, newest first — what the drafts screen lists
 *   `current_draft`    the draft the drafts screen asked the publish flow to resume
 *
 * A draft is the publish flow's FORM (`CreatePropertyFormData`) plus a summary
 * the drafts screen draws without understanding the form. It never reaches the
 * server: publishing still builds its body from the form with
 * `buildPropertyPayload`, so a resumed draft publishes exactly what the unsaved
 * form would have.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CreatePropertyFormData } from '@/store/createPropertyFormStore';

const DRAFTS_KEY = 'property_drafts';
const CURRENT_DRAFT_KEY = 'current_draft';

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
}

type StoredPropertyDraft = Omit<PropertyDraft, 'lastSaved'> & { lastSaved: string };

/** The draft the publish flow resumes: its id, so saving again replaces it. */
export interface ResumedDraft {
  id: string;
  formData: CreatePropertyFormData;
}

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

/** Saves the form under `id`, replacing an earlier save of the same draft. */
export async function saveDraft(id: string, formData: CreatePropertyFormData): Promise<void> {
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
  };
  const others = (await readDrafts()).filter((existing) => existing.id !== id);
  await writeDrafts([draft, ...others]);
}

export async function deleteDraft(id: string): Promise<PropertyDraft[]> {
  const next = (await readDrafts()).filter((draft) => draft.id !== id);
  await writeDrafts(next);
  return next;
}

/** Called by the drafts screen before it opens the publish flow. */
export async function markDraftForResume(draft: PropertyDraft): Promise<void> {
  const resumed: ResumedDraft = { id: draft.id, formData: draft.formData };
  await AsyncStorage.setItem(CURRENT_DRAFT_KEY, JSON.stringify(resumed));
}

/** Reads and clears the draft to resume, so it is applied once. */
export async function takeDraftToResume(): Promise<ResumedDraft | null> {
  const raw = await AsyncStorage.getItem(CURRENT_DRAFT_KEY);
  if (!raw) return null;
  await AsyncStorage.removeItem(CURRENT_DRAFT_KEY);
  const parsed = JSON.parse(raw) as Partial<ResumedDraft>;
  if (!parsed || typeof parsed !== 'object' || !parsed.formData || !parsed.id) return null;
  return { id: parsed.id, formData: parsed.formData };
}
