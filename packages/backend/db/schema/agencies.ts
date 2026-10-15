/** Homiio agency references and unresolved historical observations. Oxy owns company identity. */

import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, updatedAt } from '@oxy.so/db';

export const agencies = pgTable(
  'agencies',
  {
    id: generatedId(),
    oxyAccountId: text(),
    identityStatus: text({ enum: ['unresolved', 'linked', 'not_organization'] })
      .notNull()
      .default('unresolved'),

    /** Historical URL retained for both linked and unresolved source references. */
    slug: text().notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'agencies_identity_status_check',
      sql`${table.identityStatus} in ('unresolved', 'linked', 'not_organization')`,
    ),
    check(
      'agencies_identity_link_check',
      sql`(${table.identityStatus} = 'linked') = (${table.oxyAccountId} is not null)`,
    ),
    index('agencies_oxy_account_id_idx').on(table.oxyAccountId),
    uniqueIndex('agencies_slug_key').on(table.slug),
    check('agencies_slug_not_empty_check', sql`length(${table.slug}) > 0`),
  ],
);

/** Immutable source observations from the former name-based agency registry. */
export const agencyIdentityArchives = pgTable(
  'agency_identity_archives',
  {
    id: generatedId(),
    agencyId: text()
      .notNull()
      .references(() => agencies.id, { onDelete: 'restrict' }),
    observedName: text().notNull(),
    normalizedName: text().notNull(),
    archivedAt: createdAt(),
  },
  (table) => [uniqueIndex('agency_identity_archives_agency_id_key').on(table.agencyId)],
);
