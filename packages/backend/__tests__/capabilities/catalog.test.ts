/**
 * The catalogue's own invariants — what Oxy will accept, and what Homiio
 * promises about every tool.
 */

import { appCapabilityCatalogSchema } from '@oxy.so/contracts';
import { capabilityCatalogDigest } from '@oxy.so/mcp';

import { HOMIIO_CAPABILITY_CATALOG } from '../../capabilities/homiio.catalog';
import { HOMIIO_INVOCATION_HANDLERS } from '../../capabilities/homiio.handlers';

const catalog = HOMIIO_CAPABILITY_CATALOG;

/**
 * The registered identity of the catalogue. Oxy registers by (appId, version,
 * digest), so a tool changed without a version bump is a registration Oxy
 * refuses at boot. When this fails: bump `version` in `homiio.catalog.ts` and
 * copy the new pair here.
 */
const PINNED = {
  version: '1.1.0',
  digest: '41d6b666e46b765cf8dd1391650cd980d0c9d4b470e4bc8b312d6f7b7a8f2ae1',
};

describe('HOMIIO_CAPABILITY_CATALOG', () => {
  it('is a catalogue Oxy accepts', () => {
    expect(() => appCapabilityCatalogSchema.parse(catalog)).not.toThrow();
  });

  it('declares the identity Alia and the OAuth lane bind to', () => {
    expect(catalog).toMatchObject({
      appId: 'homiio',
      audience: 'oxy-homiio-api',
      internalBaseUrl: 'https://api.homiio.com',
      internalTransport: 'mcp',
      accountResourceType: 'homiio_account',
      externalMcp: { resource: 'https://mcp.homiio.com' },
    });
    expect(catalog.features).toEqual([
      expect.objectContaining({
        key: 'sindi.files',
        checkTool: 'readFileEntitlement',
        consumeTool: 'consumeFileCredit',
      }),
    ]);
  });

  it('pins its version to its digest', () => {
    expect({ version: catalog.version, digest: capabilityCatalogDigest(catalog) }).toEqual(PINNED);
  });

  it('acts on the account root only', () => {
    for (const tool of catalog.tools) expect(tool.resourceTypes).toEqual(['homiio_account']);
  });

  it('keeps money and feature gates off the public lane', () => {
    for (const tool of catalog.tools) {
      if (tool.effect === 'financial') {
        expect(tool.capabilityPackage).toBe('finance');
        expect(tool.idempotency).toBe('required');
        expect(tool.exposure).toEqual(['internal']);
        // Every amount the caller supplies is bounded by a limit key, so a
        // ceiling can cap it; a confirm or reject carries no amount at all.
        const properties = (tool.inputSchema.properties ?? {}) as Record<string, { type?: string }>;
        const amounts = Object.entries(properties)
          .filter(([, schema]) => schema.type === 'number' || schema.type === 'integer')
          .map(([key]) => key);
        const limited = tool.limitKeys.map((limit) => limit.key);
        for (const amount of amounts) expect(limited).toContain(amount);
      }
    }
    for (const name of ['readFileEntitlement', 'consumeFileCredit']) {
      expect(catalog.tools.find((tool) => tool.name === name)?.exposure).toEqual(['internal']);
    }
  });

  it('gives every effect an idempotency contract and every read none', () => {
    for (const tool of catalog.tools) {
      if (tool.effect === 'read') expect(tool.idempotency).toBe('none');
      else expect(['supported', 'required']).toContain(tool.idempotency);
    }
  });

  it('never asks for a sensitive package outside money', () => {
    for (const tool of catalog.tools) {
      expect(['security', 'delegate']).not.toContain(tool.capabilityPackage);
      if (tool.capabilityPackage === 'finance') expect(tool.effect).toBe('financial');
    }
  });

  it('has one handler per tool and no input that names an account', () => {
    expect(Object.keys(HOMIIO_INVOCATION_HANDLERS).sort()).toEqual(
      catalog.tools.map((tool) => tool.name).sort(),
    );
    for (const tool of catalog.tools) {
      const properties = Object.keys(
        (tool.inputSchema.properties as Record<string, unknown> | undefined) ?? {},
      );
      expect(properties).not.toContain('accountId');
      expect(properties).not.toContain('effectiveAccountId');
      expect(properties).not.toContain('ownerOxyUserId');
    }
  });
});
