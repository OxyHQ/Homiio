/**
 * Provider registry.
 *
 * Maps a {@link ProviderId} to its {@link ListingProvider} instance and answers
 * "which providers serve market X". The worker builds one registry at startup
 * and looks providers up per job; the API never constructs it.
 */

import type { ListingMarket, ProviderId } from '@homiio/shared-types';
import type { ListingProvider } from './types';

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, ListingProvider>();

  constructor(providers: readonly ListingProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  /** Register a provider. Throws on a duplicate id — ids must be unique. */
  register(provider: ListingProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  /** Look up a provider by id, or throw when it is not registered. */
  get(id: ProviderId): ListingProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`No provider registered for id "${id}"`);
    }
    return provider;
  }

  /** Whether a provider id is registered. */
  has(id: ProviderId): boolean {
    return this.providers.has(id);
  }

  /** All registered providers. */
  all(): ListingProvider[] {
    return [...this.providers.values()];
  }

  /** All registered ids. */
  ids(): ProviderId[] {
    return [...this.providers.keys()];
  }

  /** Registered providers that serve the given market. */
  forMarket(market: ListingMarket): ListingProvider[] {
    return this.all().filter((provider) => provider.markets.includes(market));
  }
}
