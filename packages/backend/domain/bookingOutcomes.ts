/**
 * The outcome every "start an enquiry on this listing" use case shares when
 * the listing is EXTERNAL.
 *
 * An external listing is an advertisement Homiio copied from elsewhere
 * (`isExternal: true`): nobody here can show it, host it or swap it, so no
 * viewing, reservation or exchange may ever be created against it, and no
 * contact is ever invented for it (AGENTS.md). What the person CAN do is open
 * the advertiser's own page, and that page is the one thing this outcome
 * carries.
 *
 * The Express routes keep answering their historical 400 `EXTERNAL_PROPERTY`;
 * a catalogue tool answers this typed outcome instead, so an agent sends the
 * person to `sourceUrl` rather than reading a refusal.
 */

import { eq } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '../db/postgres';
import { properties } from '../db/schema';
import { AppError } from '../middlewares/errorHandler';

export interface ExternalListingOutcome {
  readonly status: 'external_listing';
  readonly sourceUrl: string;
}

/**
 * The external outcome for one listing, read from its row.
 *
 * `properties_external_source_url_check` makes a missing `source_url` on
 * an external listing impossible, so the refusal below is the user-facing
 * answer to a row that should not exist rather than a path anybody expects.
 */
export async function externalListingOutcome(
  db: DatabaseOrTransaction,
  propertyId: string,
): Promise<ExternalListingOutcome> {
  const [row] = await db
    .select({ sourceUrl: properties.sourceUrl })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  const sourceUrl = row?.sourceUrl?.trim();
  if (!sourceUrl) {
    throw new AppError(
      'This listing is published on another website, but its link is missing',
      400,
      'EXTERNAL_PROPERTY_NO_SOURCE',
    );
  }
  return { status: 'external_listing', sourceUrl };
}

export function isExternalListingOutcome(value: unknown): value is ExternalListingOutcome {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'external_listing'
  );
}
