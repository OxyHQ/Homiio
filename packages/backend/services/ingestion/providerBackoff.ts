/**
 * A provider that proves it cannot work stops being asked, by itself.
 *
 * **WHY THIS REPLACES A LIST OF FLAGS.** Every portal used to be opt-in behind
 * its own `PROVIDER_<ID>_ENABLED`, and the result was 44 providers implemented
 * with 13 switched on — thirty-one finished portals importing nothing because a
 * variable nobody revisited said so. Inverting that default is right, but it
 * cannot be the whole change: several portals are hard-blocked today (Akamai,
 * PerimeterX, Cloudflare) and will fail every time they are asked. Running them
 * forever spends metered residential bandwidth on nothing, and an exhausted
 * balance is precisely what took the pipeline down on 2026-09-20.
 *
 * So the environment stays clean and the fleet self-corrects: a provider whose
 * discover passes keep coming back empty or failing is rested for a while, then
 * tried again. Nobody maintains a list, and a portal that starts working again
 * — a block lifted, a parser fixed — comes back on its own.
 *
 * **RESTING IS LOUD, NOT SILENT.** A rested provider logs the fact with the
 * reason. A provider that quietly stopped being tried would be the exact defect
 * this file exists to end: this pipeline has twice shipped something that
 * reported success while doing nothing.
 *
 * State is in memory, which is the right scope for it. It is a cost-avoidance
 * heuristic about the last few minutes, not a durable fact about a portal —
 * persisting it would mean a worker restart inherits a verdict formed under
 * conditions that no longer hold.
 */

/** Consecutive empty-or-failed passes before a provider is rested. */
const FAILURES_BEFORE_REST = 3;

/** How long a rested provider is skipped before being tried again. */
const REST_MS = 60 * 60 * 1000;

interface ProviderState {
  consecutiveFailures: number;
  restUntil: number;
}

export interface ProviderBackoffOptions {
  failuresBeforeRest?: number;
  restMs?: number;
  now?: () => number;
}

/**
 * Tracks which providers are worth asking right now.
 *
 * Deliberately counts a pass that yielded NOTHING the same as one that threw.
 * A portal that hard-blocks usually answers 200 with a challenge page, so
 * "produced zero listings" and "raised an error" describe the same condition
 * from the outside — and treating only the noisy one as failure would rest
 * exactly the providers that are honest about failing.
 */
export class ProviderBackoff {
  private readonly states = new Map<string, ProviderState>();
  private readonly failuresBeforeRest: number;
  private readonly restMs: number;
  private readonly now: () => number;

  constructor(options: ProviderBackoffOptions = {}) {
    this.failuresBeforeRest = options.failuresBeforeRest ?? FAILURES_BEFORE_REST;
    this.restMs = options.restMs ?? REST_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** Whether this provider should be skipped right now, and until when. */
  restingUntil(provider: string): number | undefined {
    const state = this.states.get(provider);
    if (!state || state.restUntil <= this.now()) return undefined;
    return state.restUntil;
  }

  /**
   * Record a pass that produced listings. Clears the streak outright rather
   * than decrementing it: one good pass means the portal is reachable, and a
   * provider recovering from a lifted block should not have to earn back three
   * turns before it counts.
   */
  recordSuccess(provider: string): void {
    this.states.delete(provider);
  }

  /**
   * Record a pass that yielded nothing or failed. Returns the rest deadline
   * when this was the pass that tipped it over, so the caller can say so once
   * rather than on every skip.
   */
  recordFailure(provider: string): number | undefined {
    const state = this.states.get(provider) ?? { consecutiveFailures: 0, restUntil: 0 };
    state.consecutiveFailures += 1;

    if (state.consecutiveFailures >= this.failuresBeforeRest && state.restUntil <= this.now()) {
      state.restUntil = this.now() + this.restMs;
      state.consecutiveFailures = 0;
      this.states.set(provider, state);
      return state.restUntil;
    }

    this.states.set(provider, state);
    return undefined;
  }
}
