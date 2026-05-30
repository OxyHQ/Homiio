export type PropertyNote = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  isArchived?: boolean;
  isPinned?: boolean;
  color?: string; // hex or named
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A loosely-typed note as it may appear in the persisted JSON string. Every
 * field is optional/unknown until validated and normalised into a
 * {@link PropertyNote}.
 */
interface RawPropertyNote {
  id?: unknown;
  text?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  isArchived?: unknown;
  isPinned?: unknown;
  color?: unknown;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export function parseNotesString(raw: string | undefined | null): PropertyNote[] {
  if (!raw) return [];
  const trimmed = String(raw).trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      // basic shape validation
      return (parsed as RawPropertyNote[])
        .filter((n): n is RawPropertyNote => !!n && typeof n === 'object' && typeof n.text === 'string')
        .map((n) => ({
          id: asString(n.id) || generateId(),
          text: asString(n.text) ?? '',
          createdAt: asString(n.createdAt) || new Date().toISOString(),
          updatedAt: asString(n.updatedAt) || new Date().toISOString(),
          isArchived: Boolean(n.isArchived),
          isPinned: Boolean(n.isPinned),
          color: asString(n.color) || undefined,
        }));
    }
  } catch {
    // fall through to single-note conversion
  }
  const now = new Date().toISOString();
  return [{ id: generateId(), text: trimmed, createdAt: now, updatedAt: now }];
}

export function serializeNotesArray(notes: PropertyNote[]): string {
  return JSON.stringify(notes);
}

export function upsertNote(
  notes: PropertyNote[],
  note: Partial<PropertyNote> & { text: string; id?: string },
): PropertyNote[] {
  const now = new Date().toISOString();
  if (!note.id) {
    return [
      ...notes,
      {
        id: generateId(),
        text: note.text,
        createdAt: now,
        updatedAt: now,
        isArchived: note.isArchived || false,
        isPinned: note.isPinned || false,
        color: note.color,
      },
    ];
  }
  return notes.map((n) =>
    n.id === note.id
      ? {
          ...n,
          text: note.text,
          updatedAt: now,
          isArchived: note.isArchived ?? n.isArchived,
          isPinned: note.isPinned ?? n.isPinned,
          color: note.color ?? n.color,
        }
      : n,
  );
}

export function deleteNote(notes: PropertyNote[], noteId: string): PropertyNote[] {
  return notes.filter((n) => n.id !== noteId);
}

export function toggleArchive(notes: PropertyNote[], noteId: string): PropertyNote[] {
  return notes.map((n) =>
    n.id === noteId ? { ...n, isArchived: !n.isArchived, updatedAt: new Date().toISOString() } : n,
  );
}

export function togglePin(notes: PropertyNote[], noteId: string): PropertyNote[] {
  return notes.map((n) =>
    n.id === noteId ? { ...n, isPinned: !n.isPinned, updatedAt: new Date().toISOString() } : n,
  );
}
