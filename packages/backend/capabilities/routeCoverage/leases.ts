import type { RouteCoverage } from './types';

const DOCUMENT_BYTES =
  "Returns a document's raw bytes as base64 (up to ~13 MB) for the app to open; a model context is not a file viewer, and listLeaseDocuments gives each document's metadata. The person opens the document in Homiio.";

export const LEASE_ROUTE_COVERAGE: RouteCoverage = {
  'GET /api/leases': 'listMyLeases',
  'POST /api/leases': {
    excluded:
      'A lease is only ever created from an accepted application — `/contracts/new?application=<id>` is the one entry point (AGENTS.md) — so the tool is createLeaseFromApplication, never a free-form lease.',
  },
  'GET /api/leases/:id/documents': 'listLeaseDocuments',
  'GET /api/leases/:id/documents/:documentId': { excluded: DOCUMENT_BYTES },
  'POST /api/leases/:id/documents': 'uploadLeaseDocument',
  'POST /api/leases/:id/sign': 'signLease',
  'POST /api/leases/:id/terminate': 'terminateLease',
  'POST /api/leases/:id/renew': 'renewLease',
  'GET /api/leases/:id': 'getLease',
  'PUT /api/leases/:id': 'updateLease',
  'DELETE /api/leases/:id': 'deleteLease',
};
