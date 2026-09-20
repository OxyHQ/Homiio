/**
 * The tenancy timeline draws what HAPPENED (#518 §7.4, #519 §7.4).
 *
 * §7.4: "el timeline muestra eventos reales". It did not — the whole thing was
 * rebuilt on every render from `createdAt`, two signature booleans and the two
 * term dates, so a document arriving or a notice being served could not appear
 * at all.
 *
 * Two rules decide every case below, and each one is a sentence a person reads:
 *
 *  - **An entry that claims something happened must come from a row.** The only
 *    entries this module may invent are ones that claim the OPPOSITE — a
 *    signature still missing, a date not yet reached — and those are marked
 *    `current` / `upcoming` rather than `complete`.
 *  - **A signature says what it bound to, including when it barely bound at
 *    all.** A document uploaded before Homiio hashed contents is named as such;
 *    saying nothing would be the same claim as "bound to these bytes", made
 *    silently.
 */

import type { TFunction } from 'i18next';
import {
  LeaseStatus,
  type Lease,
  type LeaseEvent,
  type LeaseSignatureRecord,
} from '@homiio/shared-types';

import {
  leaseDocuments,
  leaseTimeline,
  signingSubject,
  type LeaseFormatContext,
} from '@/components/tenancy/leaseTenancy';

const LANDLORD = 'oxy-landlord';
const TENANT = 'oxy-tenant';
const CO_TENANT = 'oxy-co-tenant';

/** `t` returns the key plus any interpolation, so a case can assert on both. */
const t = ((key: string, options?: Record<string, unknown>) =>
  options && 'name' in options ? `${key}:${String(options.name)}` : key) as unknown as TFunction;

const NAMES: Record<string, string> = {
  [LANDLORD]: 'Marta',
  [TENANT]: 'Jonas',
  [CO_TENANT]: 'Ada',
};

const context: LeaseFormatContext = {
  t,
  locale: 'en-US',
  resolveParty: (oxyUserId) => (NAMES[oxyUserId] ? { name: NAMES[oxyUserId] } : null),
  now: new Date('2026-06-01T00:00:00.000Z'),
};

let position = 0;
function event(type: LeaseEvent['type'], extra: Partial<LeaseEvent> = {}): LeaseEvent {
  position += 1;
  return {
    id: `event-${position}`,
    position,
    type,
    occurredAt: '2026-01-05T00:00:00.000Z',
    ...extra,
  };
}

function signature(extra: Partial<LeaseSignatureRecord> = {}): LeaseSignatureRecord {
  return {
    id: 'sig-1',
    party: 'tenant',
    signerOxyUserId: TENANT,
    method: 'in_app_acceptance',
    signedAt: '2026-01-05T00:00:00.000Z',
    termsSha256: 'a'.repeat(64),
    bindsCurrentTerms: true,
    ...extra,
  };
}

function lease(extra: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    propertyId: 'property-1',
    landlordOxyUserId: LANDLORD,
    tenantOxyUserId: TENANT,
    status: LeaseStatus.ACTIVE,
    leaseTerms: { startDate: '2026-01-10T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z' },
    rentDetails: { monthlyRent: 1200, currency: 'EUR' },
    signatures: { landlord: { signed: true }, tenant: { signed: true } },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
    ...extra,
  };
}

beforeEach(() => {
  position = 0;
});

describe('the timeline comes from event rows', () => {
  it('draws one entry per recorded event, in order, plus the term dates', () => {
    const timeline = leaseTimeline(
      lease({
        events: [
          event('created', { actorOxyUserId: LANDLORD }),
          event('document_added', { actorOxyUserId: LANDLORD, detail: 'Contract.pdf' }),
          event('signed', { actorOxyUserId: TENANT, detail: 'tenant' }),
          event('activated'),
        ],
        signatureRecords: [signature(), signature({ id: 'sig-2', party: 'landlord', signerOxyUserId: LANDLORD })],
      }),
      context,
    );

    expect(timeline.map((entry) => entry.title)).toEqual([
      'contracts.tenancy.event.created',
      'contracts.tenancy.event.document_added',
      'contracts.tenancy.event.signed',
      'contracts.tenancy.event.activated',
      'contracts.tenancy.starts',
      'contracts.tenancy.ends',
    ]);
    // Every recorded entry is `complete`, because every one of them happened.
    expect(timeline.slice(0, 4).every((entry) => entry.state === 'complete')).toBe(true);
    // The term dates are not events. One is in the past, one is not.
    expect(timeline[4].state).toBe('complete');
    expect(timeline[5].state).toBe('upcoming');
  });

  it('names the person who did it, and nobody for an activation', () => {
    const timeline = leaseTimeline(
      lease({
        events: [event('signed', { actorOxyUserId: CO_TENANT }), event('activated')],
        coTenants: [{ oxyUserId: CO_TENANT }],
        signatureRecords: [
          signature({ party: 'co_tenant', signerOxyUserId: CO_TENANT }),
          signature({ id: 'sig-2', party: 'landlord', signerOxyUserId: LANDLORD }),
          signature({ id: 'sig-3', party: 'tenant', signerOxyUserId: TENANT }),
        ],
      }),
      context,
    );

    expect(timeline[0].actor).toBe('Ada');
    // The lease became active because the last signature arrived. Crediting
    // whoever signed last would attribute to one person what every party did.
    expect(timeline[1].actor).toBeUndefined();
  });

  it('shows a document event under the name the document had', () => {
    const timeline = leaseTimeline(
      lease({ events: [event('document_added', { detail: 'Inventory.pdf' })] }),
      context,
    );
    expect(timeline[0].description).toBe('Inventory.pdf');
  });

  it('shows a termination reason and drops the end date it never reached', () => {
    const timeline = leaseTimeline(
      lease({
        status: LeaseStatus.TERMINATED,
        events: [event('created'), event('terminated', { detail: 'Moving abroad' })],
      }),
      context,
    );

    const terminated = timeline.find((entry) => entry.title === 'contracts.tenancy.event.terminated');
    expect(terminated?.description).toBe('Moving abroad');
    expect(terminated?.tone).toBe('error');
    expect(timeline.map((entry) => entry.title)).not.toContain('contracts.tenancy.ends');
  });

  it('does not show a renewal’s lease id, which is not for a person to read', () => {
    const timeline = leaseTimeline(
      lease({ events: [event('renewed', { detail: '01a0bd3d-81e7-7d57-b0a3-838f21c6fdb2' })] }),
      context,
    );
    expect(timeline[0].description).toBeUndefined();
  });
});

describe('a signature entry says WHAT was signed', () => {
  const signedTimeline = (record: LeaseSignatureRecord) =>
    leaseTimeline(
      lease({
        events: [event('signed', { actorOxyUserId: record.signerOxyUserId })],
        signatureRecords: [record],
      }),
      context,
    )[0];

  it('names the document and the terms when the bytes were recorded', () => {
    const entry = signedTimeline(
      signature({ documentId: 'doc-1', documentName: 'Contract.pdf', documentSha256: 'b'.repeat(64) }),
    );
    expect(entry.description).toBe('contracts.tenancy.signedDocument:Contract.pdf');
  });

  it('says so when the document predates content hashing', () => {
    // The weakest binding the schema can express. Drawing it the same as the
    // case above would claim the bytes were checked; drawing nothing would
    // claim it silently.
    const entry = signedTimeline(signature({ documentId: 'doc-1', documentName: 'Old.pdf' }));
    expect(entry.description).toBe('contracts.tenancy.signedDocumentUnhashed:Old.pdf');
  });

  it('says the terms alone when the lease had no contract document', () => {
    const entry = signedTimeline(signature());
    expect(entry.description).toBe('contracts.tenancy.signedTermsOnly');
  });

  it('marks a signature the lease has been amended past', () => {
    const entry = signedTimeline(signature({ bindsCurrentTerms: false }));
    expect(entry.description).toContain('contracts.tenancy.signatureStale');
  });

  it('does NOT mark a signature stale while it still binds', () => {
    // The permit. A version that always appended the warning would pass every
    // "it says stale" assertion above.
    const entry = signedTimeline(signature());
    expect(entry.description).not.toContain('contracts.tenancy.signatureStale');
  });
});

describe('whose signature the lease is still waiting for', () => {
  it('lists every unsigned party, co-tenants included, as not-yet', () => {
    const timeline = leaseTimeline(
      lease({
        status: LeaseStatus.PENDING_SIGNATURES,
        coTenants: [{ oxyUserId: CO_TENANT }],
        events: [event('created'), event('signed', { actorOxyUserId: LANDLORD })],
        signatureRecords: [signature({ party: 'landlord', signerOxyUserId: LANDLORD })],
      }),
      context,
    );

    const pending = timeline.filter((entry) => entry.state === 'current');
    expect(pending.map((entry) => entry.title)).toEqual([
      'contracts.tenancy.tenantPending',
      'contracts.tenancy.coTenantPending',
    ]);
    // Never `complete`: nobody signing is not something that happened.
    expect(pending.every((entry) => entry.state !== 'complete')).toBe(true);
  });

  it('lists nobody once everyone has signed', () => {
    const timeline = leaseTimeline(
      lease({
        coTenants: [{ oxyUserId: CO_TENANT }],
        events: [event('activated')],
        signatureRecords: [
          signature({ party: 'landlord', signerOxyUserId: LANDLORD }),
          signature({ id: 'sig-2', party: 'tenant', signerOxyUserId: TENANT }),
          signature({ id: 'sig-3', party: 'co_tenant', signerOxyUserId: CO_TENANT }),
        ],
      }),
      context,
    );
    expect(timeline.filter((entry) => entry.state === 'current')).toEqual([]);
  });
});

describe('a lease with no event rows', () => {
  it('falls back to the pre-0028 derivation rather than drawing an empty column', () => {
    // `events: undefined` (a list read) and `events: []` (a lease older than
    // the table) are both possible and neither means "nothing happened".
    for (const events of [undefined, [] as LeaseEvent[]]) {
      const timeline = leaseTimeline(lease({ events }), context);
      expect(timeline.map((entry) => entry.title)).toEqual([
        'contracts.tenancy.created',
        'contracts.tenancy.landlordSigned',
        'contracts.tenancy.tenantSigned',
        'contracts.tenancy.starts',
        'contracts.tenancy.ends',
      ]);
    }
  });
});

describe('what a person is told they are signing', () => {
  const document = (id: string, type: 'lease_agreement' | 'insurance', uploadedDate: string) => ({
    id,
    name: `${id}.pdf`,
    downloadPath: `/api/leases/lease-1/documents/${id}`,
    type,
    uploadedBy: LANDLORD,
    uploadedDate,
  });

  it('names the newest lease agreement — the document the SERVER will bind to', () => {
    const subject = signingSubject(
      lease({
        documents: [
          document('old', 'lease_agreement', '2026-01-01T00:00:00.000Z'),
          document('new', 'lease_agreement', '2026-02-01T00:00:00.000Z'),
          // Later still, and not the agreement being entered into.
          document('insurance', 'insurance', '2026-03-01T00:00:00.000Z'),
        ],
      }),
      context,
    );
    expect(subject).toBe('contracts.tenancy.signingDocument:new.pdf');
  });

  it('says the terms alone when there is no contract document', () => {
    expect(signingSubject(lease({ documents: [] }), context)).toBe(
      'contracts.tenancy.signingTermsOnly',
    );
  });
});

describe('the document list marks what was signed', () => {
  const docs = [
    {
      id: 'doc-1',
      name: 'Contract.pdf',
      downloadPath: '/api/leases/lease-1/documents/doc-1',
      type: 'lease_agreement' as const,
      uploadedBy: LANDLORD,
      uploadedDate: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 'doc-2',
      name: 'Inventory.pdf',
      downloadPath: '/api/leases/lease-1/documents/doc-2',
      type: 'addendum' as const,
      uploadedBy: LANDLORD,
      uploadedDate: '2026-02-02T00:00:00.000Z',
    },
  ];

  it('marks only the document a signature actually names', () => {
    const rows = leaseDocuments(
      lease({ documents: docs, signatureRecords: [signature({ documentId: 'doc-1' })] }),
      context,
      () => undefined,
    );
    expect(rows[0].status).toBe('signed');
    // Not inferred from "the lease is signed and this is a document": that
    // would tick a file uploaded after the signatures were made.
    expect(rows[1].status).toBeUndefined();
  });

  it('marks nothing when nobody has signed', () => {
    const rows = leaseDocuments(
      lease({ documents: docs, signatureRecords: [] }),
      context,
      () => undefined,
    );
    expect(rows.every((row) => row.status === undefined)).toBe(true);
  });
});
