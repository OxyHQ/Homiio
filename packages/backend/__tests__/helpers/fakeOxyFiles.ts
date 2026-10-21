/**
 * An in-memory Oxy Files for the test suite — the `OxyFilesApi` surface Homiio
 * calls (`services/files/oxyFilesClient.ts`), with Oxy's rules where Homiio's
 * behaviour depends on them:
 *
 * - per-owner SHA-256 dedupe (re-uploading bytes an owner holds answers the
 *   same file);
 * - import by URL remembered per owner (a repeat answers `existing`, no fetch);
 * - references unique per (file, entity type, entity id); `add` answers
 *   `not_found` for a file that is gone or not active;
 * - a reconciliation adds what the inventory lists and removes what it does not;
 * - consent (stage 4c): a person's file Homiio stored for them is readable
 *   through `linkedDownloadUrls` until the person revokes Homiio
 *   ({@link FakeOxyFiles.revokeAccess}); absence from the answer is the refusal.
 *
 * Installed for every suite by `__tests__/jest.setup.ts`, so no test can reach
 * a real Oxy; a test that needs to see what was sent imports {@link fakeOxyFiles}.
 */

import { createHash } from 'node:crypto';

import type {
  ApplicationFileImport,
  ApplicationFileImportBatchResult,
  ApplicationFileUpload,
  ServiceAssetMetadata,
  ServiceFileReference,
  ServiceFileReferenceResult,
  ServiceReferenceInventoryItem,
  ServiceReferenceReconcileResult,
  ServiceUserMediaFile,
} from '@oxy.so/core';

import type { OxyFilesApi } from '../../services/files/oxyFilesSeam';

type ServiceLinkedDownloadUrl = Awaited<ReturnType<OxyFilesApi['linkedDownloadUrls']>>[number];

export const FAKE_HOMIIO_APP_ID = 'homiio-app';

export interface FakeFile {
  id: string;
  sha256: string;
  size: number;
  mime: string;
  ownerUserId: string | null;
  ownerApplicationId: string | null;
  status: 'active' | 'trash' | 'blocked' | 'deleted';
  visibility: 'public' | 'unlisted' | 'private';
  bytes: Buffer;
}

/** An error shaped like the SDK's: `status` and `code`. */
export function oxyError(status: number, code: string): Error & { status: number; code: string } {
  return Object.assign(new Error(`${status} ${code}`), { status, code });
}

function sha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class FakeOxyFiles {
  readonly files = new Map<string, FakeFile>();
  /** `fileId|entityType|entityId`. */
  readonly referenceSet = new Set<string>();
  /** `owner|url` → file id. */
  readonly sources = new Map<string, string>();
  /** Accounts Oxy no longer has (uploadUserMedia refuses them with 403). */
  readonly refusedUsers = new Set<string>();
  /** Source URLs whose import fails with this status. */
  readonly failingSources = new Map<string, number>();
  /** Thrown by the next batch-import requests, one per request (a 429, an outage). */
  readonly batchImportErrors: Error[] = [];
  /** Every call, for assertions. */
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  /** When set, every references call throws this. */
  referencesError: Error | null = null;
  /** When set, every large upload throws this (an outage, a refusal). */
  largeUploadError: Error | null = null;
  /** Thrown by the next large uploads, one per call, before {@link largeUploadError}. */
  readonly largeUploadErrors: Error[] = [];
  /** When set, a large upload answers this visibility whatever was asked (a pre-4c API). */
  largeUploadVisibilityOverride: FakeFile['visibility'] | null = null;
  /** When true, `linkedDownloadUrls` omits every person's file (Oxy before stage 4c). */
  consentReadUnavailable = false;
  /** Person files Homiio stored for them (an upload grant), by id. */
  readonly grants = new Set<string>();
  /** Person files whose owner revoked Homiio's access. */
  readonly revoked = new Set<string>();
  /** Linked URLs whose download answers these bytes instead (a tampered transfer). */
  readonly tamperedDownloads = new Map<string, Buffer>();
  private counter = 0;

  reset(): void {
    this.files.clear();
    this.referenceSet.clear();
    this.sources.clear();
    this.refusedUsers.clear();
    this.failingSources.clear();
    this.batchImportErrors.length = 0;
    this.calls.length = 0;
    this.referencesError = null;
    this.largeUploadError = null;
    this.largeUploadErrors.length = 0;
    this.largeUploadVisibilityOverride = null;
    this.consentReadUnavailable = false;
    this.grants.clear();
    this.revoked.clear();
    this.tamperedDownloads.clear();
  }

  /** The person withdraws Homiio's access to their file (`DELETE /assets/:id/access/:app`). */
  revokeAccess(fileId: string): void {
    this.revoked.add(fileId);
  }

  /** The URL `linkedDownloadUrls` mints for a file. */
  linkedUrl(fileId: string): string {
    return `https://cloud.oxy.test/linked/${fileId}?signature=fake`;
  }

  /** What fetching a linked URL answers: the file's bytes, unless tampered. */
  async download(url: string): Promise<Buffer> {
    const tampered = this.tamperedDownloads.get(url);
    if (tampered) return tampered;
    const match = /^https:\/\/cloud\.oxy\.test\/linked\/([^?]+)\?/.exec(url);
    const file = match ? this.files.get(match[1]) : undefined;
    if (!file || file.status !== 'active') throw oxyError(403, 'EXPIRED');
    return file.bytes;
  }

  callsOf(method: string): unknown[][] {
    return this.calls.filter((call) => call.method === method).map((call) => call.args);
  }

  hasReference(fileId: string, entityType: string, entityId: string): boolean {
    return this.referenceSet.has(`${fileId}|${entityType}|${entityId}`);
  }

  private store(
    bytes: Buffer,
    mime: string,
    owner: { userId: string } | { app: true },
    visibility: FakeFile['visibility'],
  ): { file: FakeFile; deduplicated: boolean } {
    const digest = sha(bytes);
    for (const file of this.files.values()) {
      const sameOwner =
        'userId' in owner ? file.ownerUserId === owner.userId : file.ownerApplicationId !== null;
      if (sameOwner && file.sha256 === digest && file.status !== 'deleted') {
        return { file, deduplicated: true };
      }
    }
    this.counter += 1;
    const file: FakeFile = {
      id: `file${String(this.counter).padStart(6, '0')}`,
      sha256: digest,
      size: bytes.length,
      mime,
      ownerUserId: 'userId' in owner ? owner.userId : null,
      ownerApplicationId: 'userId' in owner ? null : FAKE_HOMIIO_APP_ID,
      status: 'active',
      visibility,
      bytes,
    };
    this.files.set(file.id, file);
    return { file, deduplicated: false };
  }

  private applicationFile(file: FakeFile) {
    return {
      id: file.id,
      sha256: file.sha256,
      size: file.size,
      mime: file.mime,
      ext: file.mime.split('/')[1] ?? 'bin',
      ownerApplicationId: FAKE_HOMIIO_APP_ID,
      status: file.status === 'deleted' ? 'trash' : file.status,
      visibility: file.visibility,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    } as ApplicationFileUpload['file'];
  }

  /** The bytes a source URL serves: deterministic, so dedupe is observable. */
  sourceBytes(url: string): Buffer {
    return Buffer.from(`image-bytes:${url}`);
  }

  private importOne(
    sourceUrl: string,
    options: {
      visibility: FakeFile['visibility'];
      reference?: { entityType: string; entityId: string };
    },
  ): ApplicationFileImport {
    const failing = this.failingSources.get(sourceUrl);
    if (failing)
      throw oxyError(failing, failing === 504 ? 'SOURCE_FETCH_TIMEOUT' : 'SOURCE_FETCH_FAILED');
    if (!sourceUrl.startsWith('https://')) throw oxyError(422, 'SOURCE_URL_REFUSED');
    const sourceKey = `app|${sourceUrl}`;
    const known = this.sources.get(sourceKey);
    let file: FakeFile;
    let outcome: ApplicationFileImport['outcome'] = 'downloaded';
    let deduplicated = false;
    if (known && this.files.get(known)?.status === 'active') {
      file = this.files.get(known) as FakeFile;
      outcome = 'existing';
    } else {
      const stored = this.store(
        this.sourceBytes(sourceUrl),
        'image/jpeg',
        { app: true },
        options.visibility,
      );
      file = stored.file;
      deduplicated = stored.deduplicated;
      this.sources.set(sourceKey, file.id);
    }
    let reference: ApplicationFileImport['reference'];
    if (options.reference) {
      const key = `${file.id}|${options.reference.entityType}|${options.reference.entityId}`;
      reference = { result: this.referenceSet.has(key) ? 'exists' : 'created' };
      this.referenceSet.add(key);
    }
    return {
      file: this.applicationFile(file),
      outcome,
      deduplicated,
      source: { host: new URL(sourceUrl).host, fetchedAt: new Date(0).toISOString() },
      ...(reference ? { reference } : {}),
    };
  }

  /** The `OxyFilesApi` the code under test receives. */
  api(): OxyFilesApi {
    const api = {
      publicUrl: (fileId: string, variant?: string) =>
        `https://cloud.oxy.test/${fileId}${variant ? `?variant=${variant}` : ''}`,

      uploadAppFile: async (
        bytes: Uint8Array | ArrayBuffer | Blob,
        mime: string,
        options: { visibility: FakeFile['visibility'] },
      ): Promise<ApplicationFileUpload> => {
        this.calls.push({ method: 'uploadAppFile', args: [mime, options] });
        const buffer = Buffer.from(bytes as Uint8Array);
        const { file, deduplicated } = this.store(buffer, mime, { app: true }, options.visibility);
        return { file: this.applicationFile(file), deduplicated };
      },

      uploadUserMedia: async (
        ownerUserId: string,
        bytes: Uint8Array | ArrayBuffer | Blob,
        mime: string,
      ): Promise<ServiceUserMediaFile> => {
        this.calls.push({ method: 'uploadUserMedia', args: [ownerUserId, mime] });
        if (this.refusedUsers.has(ownerUserId)) {
          throw oxyError(403, 'FORBIDDEN');
        }
        const buffer = Buffer.from(bytes as Uint8Array);
        const { file } = this.store(buffer, mime, { userId: ownerUserId }, 'public');
        return {
          id: file.id,
          sha256: file.sha256,
          size: file.size,
          mime: file.mime,
          visibility: file.visibility,
        };
      },

      uploadUserMediaLarge: async (
        ownerUserId: string,
        source: Uint8Array | ArrayBuffer | Blob | string,
        options: { mime: string; visibility?: FakeFile['visibility']; sha256?: string },
      ) => {
        this.calls.push({ method: 'uploadUserMediaLarge', args: [ownerUserId, options] });
        const queued = this.largeUploadErrors.shift();
        if (queued) throw queued;
        if (this.largeUploadError) throw this.largeUploadError;
        if (this.refusedUsers.has(ownerUserId)) throw oxyError(403, 'FORBIDDEN');
        if (typeof source === 'string' || source instanceof Blob) {
          throw new Error('the fake takes bytes');
        }
        const buffer = Buffer.from(source as Uint8Array);
        if (options.sha256 && options.sha256 !== sha(buffer)) {
          throw oxyError(422, 'CHECKSUM_MISMATCH');
        }
        const visibility =
          this.largeUploadVisibilityOverride ?? options.visibility ?? ('public' as const);
        const { file, deduplicated } = this.store(
          buffer,
          options.mime,
          { userId: ownerUserId },
          visibility,
        );
        // Stored FOR the person: Homiio may read it until they revoke that.
        this.grants.add(file.id);
        return {
          file: {
            id: file.id,
            sha256: file.sha256,
            size: file.size,
            mime: file.mime,
            visibility: file.visibility,
            status: file.status === 'deleted' ? 'trash' : file.status,
          },
          deduplicated,
          uploadId: deduplicated ? null : `upload-${file.id}`,
        };
      },

      linkedDownloadUrls: async (ids: string[]): Promise<ServiceLinkedDownloadUrl[]> => {
        this.calls.push({ method: 'linkedDownloadUrls', args: [ids] });
        return ids.flatMap((id) => {
          const file = this.files.get(id);
          if (!file || file.status !== 'active') return [];
          const readable =
            file.ownerApplicationId !== null ||
            (!this.consentReadUnavailable && this.grants.has(id) && !this.revoked.has(id));
          if (!readable) return [];
          return [
            {
              id,
              url: this.linkedUrl(id),
              expiresIn: 300,
              mime: file.mime,
              size: file.size,
              sha256: file.sha256,
            },
          ];
        });
      },

      importAppFile: async (
        sourceUrl: string,
        options: {
          visibility: FakeFile['visibility'];
          reference?: { entityType: string; entityId: string };
        },
      ): Promise<ApplicationFileImport> => {
        this.calls.push({ method: 'importAppFile', args: [sourceUrl, options] });
        return this.importOne(sourceUrl, options);
      },

      importAppFiles: async (
        items: Array<{
          sourceUrl: string;
          visibility: FakeFile['visibility'];
          reference?: { entityType: string; entityId: string };
        }>,
      ): Promise<ApplicationFileImportBatchResult[]> => {
        this.calls.push({ method: 'importAppFiles', args: [items] });
        const refusal = this.batchImportErrors.shift();
        if (refusal) throw refusal;
        return items.map((item, index): ApplicationFileImportBatchResult => {
          try {
            return { index, ok: true, ...this.importOne(item.sourceUrl, item) };
          } catch (error) {
            const status = (error as { status?: number }).status ?? 500;
            const code = (error as { code?: string }).code ?? 'ERROR';
            return { index, ok: false, error: { status, code, message: code } };
          }
        });
      },

      metadataByIds: async (ids: string[]): Promise<ServiceAssetMetadata[]> => {
        this.calls.push({ method: 'metadataByIds', args: [ids] });
        return ids.flatMap((id) => {
          const file = this.files.get(id);
          if (!file || file.status === 'deleted') return [];
          return [
            {
              id: file.id,
              sha256: file.sha256,
              mime: file.mime,
              size: file.size,
              status: file.status,
              ownerUserId: file.ownerUserId,
              ...(file.ownerApplicationId ? { ownerApplicationId: file.ownerApplicationId } : {}),
            } as ServiceAssetMetadata,
          ];
        });
      },

      references: {
        add: async (refs: ServiceFileReference[]): Promise<ServiceFileReferenceResult[]> => {
          this.calls.push({ method: 'references.add', args: [refs] });
          if (this.referencesError) throw this.referencesError;
          return refs.map((ref) => {
            const file = this.files.get(ref.fileId);
            if (!file || file.status !== 'active') return { ...ref, result: 'not_found' as const };
            const key = `${ref.fileId}|${ref.entityType}|${ref.entityId}`;
            const existed = this.referenceSet.has(key);
            this.referenceSet.add(key);
            return { ...ref, result: existed ? ('exists' as const) : ('created' as const) };
          });
        },
        remove: async (refs: ServiceFileReference[]): Promise<ServiceFileReferenceResult[]> => {
          this.calls.push({ method: 'references.remove', args: [refs] });
          if (this.referencesError) throw this.referencesError;
          return refs.map((ref) => {
            const key = `${ref.fileId}|${ref.entityType}|${ref.entityId}`;
            const existed = this.referenceSet.delete(key);
            return { ...ref, result: existed ? ('removed' as const) : ('not_found' as const) };
          });
        },
        reconcile: async (
          entityType: string,
          items:
            | Iterable<ServiceReferenceInventoryItem>
            | AsyncIterable<ServiceReferenceInventoryItem>,
          options: { dryRun?: boolean } = {},
        ): Promise<ServiceReferenceReconcileResult> => {
          this.calls.push({ method: 'references.reconcile', args: [entityType, options] });
          const listed = new Set<string>();
          for await (const item of items)
            listed.add(`${item.fileId}|${entityType}|${item.entityId}`);
          const held = [...this.referenceSet].filter((key) => key.split('|')[1] === entityType);
          let added = 0;
          let refused = 0;
          let unchanged = 0;
          for (const key of listed) {
            if (this.referenceSet.has(key)) {
              unchanged += 1;
            } else if (this.files.get(key.split('|')[0])?.status !== 'active') {
              refused += 1;
            } else {
              added += 1;
              if (!options.dryRun) this.referenceSet.add(key);
            }
          }
          const stale = held.filter((key) => !listed.has(key));
          if (!options.dryRun) for (const key of stale) this.referenceSet.delete(key);
          return {
            sessionId: 'fake-session',
            entityType,
            dryRun: options.dryRun === true,
            added,
            removed: stale.length,
            unchanged,
            refused,
          };
        },
      },
    };
    return api as unknown as OxyFilesApi;
  }
}

/** The suite's one instance; `jest.setup.ts` installs it and resets it per test file. */
export const fakeOxyFiles = new FakeOxyFiles();
