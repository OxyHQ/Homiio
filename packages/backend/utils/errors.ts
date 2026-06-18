export function getErrorName(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  return typeof error.name === 'string' ? error.name : undefined;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }

  return String(error);
}

export function getValidationMessages(error: unknown): string[] {
  if (!isRecord(error) || !isRecord(error.errors)) {
    return [];
  }

  return Object.values(error.errors)
    .map((entry) => (isRecord(entry) && typeof entry.message === 'string' ? entry.message : undefined))
    .filter((message): message is string => Boolean(message));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

