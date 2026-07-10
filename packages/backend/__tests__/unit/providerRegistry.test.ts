/**
 * Provider registry contract tests (pure — no DB, no network).
 */

import {
  FixtureProvider,
  IdealistaProvider,
  ProviderRegistry,
} from '@homiio/listing-providers';

describe('ProviderRegistry', () => {
  it('registers providers and resolves by id', () => {
    const fixture = new FixtureProvider();
    const registry = new ProviderRegistry([fixture]);
    expect(registry.has('fixture')).toBe(true);
    expect(registry.get('fixture').id).toBe('fixture');
    expect(registry.ids()).toEqual(['fixture']);
  });

  it('throws on duplicate registration', () => {
    const registry = new ProviderRegistry([new FixtureProvider()]);
    expect(() => registry.register(new FixtureProvider())).toThrow(/already registered/);
  });

  it('throws when looking up an unregistered id', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.get('idealista')).toThrow(/No provider registered/);
  });

  it('filters providers by market', () => {
    const registry = new ProviderRegistry([new FixtureProvider(), new IdealistaProvider()]);
    const esProviders = registry.forMarket('ES').map((provider) => provider.id).sort();
    expect(esProviders).toEqual(['fixture', 'idealista']);
    expect(registry.forMarket('US')).toHaveLength(0);
  });
});
