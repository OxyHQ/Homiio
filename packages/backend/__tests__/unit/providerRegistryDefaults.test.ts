/**
 * Every implemented provider runs unless someone says otherwise.
 *
 * The registry used to be opt-in: a plugin had to be implemented, merged, AND
 * remembered in a task definition before it did anything. Measured on
 * 2026-09-21 — **44 providers implemented, 13 switched on**. Thirty-one
 * finished portals imported nothing because a variable nobody revisited said
 * so, and three of the thirteen that *were* on still imported nothing for an
 * unrelated reason. Nothing in the system could tell those two cases apart.
 *
 * Inverting the default means a provider that ships is a provider that runs,
 * and the environment carries one variable instead of forty-four.
 */

import { createDefaultRegistry } from '@homiio/listing-providers';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('createDefaultRegistry', () => {
  it('registers every provider when nothing is disabled', () => {
    delete process.env.LISTING_DISABLED_PROVIDERS;
    const ids = createDefaultRegistry().ids();

    // The exact count is not pinned — new providers land often and a test that
    // demands a number would fail on every addition for no reason. What is
    // pinned is the SHAPE: far more than the thirteen the flags allowed, and
    // the specific portals that were dark.
    expect(ids.length).toBeGreaterThan(40);
    for (const id of ['zillow', 'zoopla', 'idealista', 'funda', 'casa_it', 'leboncoin']) {
      expect(ids).toContain(id);
    }
  });

  it('keeps the fixture provider, which touches no portal', () => {
    expect(createDefaultRegistry().ids()).toContain('fixture');
  });

  it('honours LISTING_DISABLED_PROVIDERS', () => {
    process.env.LISTING_DISABLED_PROVIDERS = 'zillow,redfin';
    const ids = createDefaultRegistry().ids();

    expect(ids).not.toContain('zillow');
    expect(ids).not.toContain('redfin');
    expect(ids).toContain('zoopla');
  });

  it('tolerates the spacing and casing a human types into a task definition', () => {
    // This is edited by hand in the AWS console under time pressure. A list
    // that silently ignores ` Zillow ` would leave a provider running that
    // somebody believed they had just switched off.
    process.env.LISTING_DISABLED_PROVIDERS = '  Zillow , REDFIN,, hotpads  ';
    const ids = createDefaultRegistry().ids();

    expect(ids).not.toContain('zillow');
    expect(ids).not.toContain('redfin');
    expect(ids).not.toContain('hotpads');
  });

  it('treats an empty or absent list as "disable nothing"', () => {
    const baseline = createDefaultRegistry().ids().length;

    for (const value of ['', '   ', ',,,']) {
      process.env.LISTING_DISABLED_PROVIDERS = value;
      expect(createDefaultRegistry().ids()).toHaveLength(baseline);
    }
  });

  it('ignores a name that matches no provider instead of throwing', () => {
    // A stale entry left behind after a provider is renamed or removed must not
    // take the worker down on boot.
    process.env.LISTING_DISABLED_PROVIDERS = 'a_portal_that_never_existed';
    expect(createDefaultRegistry().ids().length).toBeGreaterThan(40);
  });

  it('no longer reads the per-provider flags', () => {
    // The old variables are gone from the task definition. If the registry
    // still consulted them, a leftover `false` in some other environment would
    // silently switch a provider back off.
    process.env.PROVIDER_ZILLOW_ENABLED = 'false';
    process.env.PROVIDER_ZOOPLA_ENABLED = 'false';

    const ids = createDefaultRegistry().ids();
    expect(ids).toContain('zillow');
    expect(ids).toContain('zoopla');
  });
});
