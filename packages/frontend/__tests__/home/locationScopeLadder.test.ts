/**
 * The initial-scope ladder, rung by rung (#353, superseded in part by #518/#519).
 *
 * Every mandatory test case the issues list for the resolution rules is here,
 * and each is an ordinary assertion over a pure function rather than a timing
 * simulation — see `hooks/locationScopeLadder.ts` for why that was the shape
 * chosen. Four of these could not be written honestly any other way:
 *
 *  - "respuesta tardía de la ubicación anterior que no sobrescribe la nueva"
 *    becomes "a device answer supplied alongside an explicit choice loses",
 *    which is true regardless of when either arrived;
 *  - "una respuesta automática tardía no debe mover el mapa y sustituir los
 *    resultados" becomes "a device answer supplied alongside a COMMITTED
 *    network scope loses, and becomes an offer";
 *  - "nunca ejecutar silenciosamente el feed global" becomes an exhaustive
 *    sweep asserting that NO combination of inputs reaches `isGlobal` except the
 *    one flag a button sets;
 *  - "no aparece el bloque «One step first» ni una barrera equivalente" becomes
 *    a sweep asserting the ladder has no state that both withholds an area AND
 *    reports itself as anything other than `discovery` — the regression gate
 *    the issues ask for by name.
 */

import {
  resolveLocationScope,
  type ApproximatePositionState,
  type CommittedAutoScope,
  type DevicePositionState,
} from '@/hooks/locationScopeLadder';
import type { LocationSelection } from '@homiio/shared-types';

function place(id: string, name: string): LocationSelection {
  return {
    kind: 'place',
    source: { kind: 'homiio', entity: 'city', id },
    placeType: 'city',
    label: { primary: name, kind: 'place' },
    admin: { countryCode: 'ES', cityName: name },
    precision: 'centroid',
    center: { longitude: 2.1686, latitude: 41.3874 },
  };
}

const BARCELONA = place('city-barcelona', 'Barcelona');
const MADRID = place('city-madrid', 'Madrid');

const DEVICE_FIX: LocationSelection = {
  kind: 'current_location',
  center: { longitude: 26.1025, latitude: 44.4268 },
  radiusMeters: 25_000,
  precision: 'exact',
};

const NOTHING: DevicePositionState = { status: 'idle' };

/** A network inference resolved to a city. Never a `current_location`. */
const BUCHAREST = place('city-bucharest', 'Bucharest');

const IP_RESOLVED: ApproximatePositionState = {
  status: 'resolved',
  selection: BUCHAREST,
  granularity: 'city',
};

const NO_IP: ApproximatePositionState = { status: 'unavailable' };

/** The ladder's inputs with everything absent, for a test to fill in one rung. */
const EMPTY = {
  explicitGlobal: false,
  sessionSelection: null,
  savedAreaSelection: null,
  lastChosenSelection: null,
  device: NOTHING,
  approximate: NO_IP,
  committedAuto: null,
} as const;

describe('permission states', () => {
  it('granted: the device position becomes the scope', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.selection).toEqual(DEVICE_FIX);
    expect(state.source).toBe('device');
    expect(state.canQuery).toBe(true);
    expect(state.isGlobal).toBe(false);
  });

  it('denied, with a network answer: the network answers and nothing is blocked', () => {
    // The case the whole change exists for. A denied permission used to end at
    // the mandatory picker; now it simply means the device rung does not
    // participate, and the connection places the visitor instead.
    const state = resolveLocationScope({
      ...EMPTY,
      device: { status: 'failed', reason: 'permission_denied' },
      approximate: IP_RESOLVED,
    });

    expect(state.selection).toEqual(BUCHAREST);
    expect(state.source).toBe('ip');
    expect(state.canQuery).toBe(true);
    expect(state.discovery).toBe(false);
    // Inferred, and the surface must say so.
    expect(state.isApproximate).toBe(true);
    expect(state.granularity).toBe('city');
    // The REASON survives, so the surface can still say "location is off" if it
    // has somewhere to say it.
    expect(state.deviceIssue).toBe('permission_denied');
  });

  it('denied, with no network answer either: DISCOVERY, not a barrier', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      device: { status: 'failed', reason: 'permission_denied' },
    });

    expect(state.discovery).toBe(true);
    expect(state.canQuery).toBe(false);
    // The whole point: a denial must not become a worldwide list.
    expect(state.isGlobal).toBe(false);
    expect(state.selection).toBeNull();
    expect(state.resolution).toEqual({ status: 'failed', reason: 'permission_denied' });
  });

  it('revoked while an area is in use: the area SURVIVES and the loss is reported', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      lastChosenSelection: BARCELONA,
      device: { status: 'failed', reason: 'permission_denied' },
    });

    // "Mantener la última selección válida si existe" …
    expect(state.selection).toEqual(BARCELONA);
    expect(state.canQuery).toBe(true);
    // … and "mostrar que la ubicación actual ya no está disponible". Both at
    // once, which is why the failure is a separate field from the resolution.
    expect(state.deviceIssue).toBe('permission_denied');
    expect(state.resolution).toEqual({ status: 'resolved', selection: BARCELONA });
  });

  it('GPS timeout with the network available: the network answers', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      device: { status: 'failed', reason: 'position_unavailable' },
      approximate: IP_RESOLVED,
    });

    expect(state.source).toBe('ip');
    expect(state.canQuery).toBe(true);
    expect(state.isGlobal).toBe(false);
  });

  it('GPS timeout with nothing else: discovery, not a global feed', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      device: { status: 'failed', reason: 'position_unavailable' },
    });

    expect(state.discovery).toBe(true);
    expect(state.canQuery).toBe(false);
    expect(state.isGlobal).toBe(false);
  });

  it('resolving: neither a query nor a board, so nothing flashes', () => {
    const state = resolveLocationScope({ ...EMPTY, device: { status: 'resolving' } });

    expect(state.canQuery).toBe(false);
    // The destinations board flashing open for the half-second a fix takes and
    // then being replaced is the same jump the commit rule exists to prevent,
    // arriving at the top of the sequence instead of the end.
    expect(state.discovery).toBe(false);
    expect(state.resolution).toEqual({ status: 'resolving' });
  });

  it('waits for the network rung too, not only the device one', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      device: { status: 'idle' },
      approximate: { status: 'resolving' },
    });

    expect(state.resolution).toEqual({ status: 'resolving' });
    expect(state.discovery).toBe(false);
  });
});

describe('rung order', () => {
  it('an explicit session choice outranks a saved area, the last area and the device', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      sessionSelection: MADRID,
      savedAreaSelection: BARCELONA,
      lastChosenSelection: BARCELONA,
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.selection).toEqual(MADRID);
    expect(state.source).toBe('session');
  });

  it('a saved area outranks the last chosen area and the device', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      savedAreaSelection: BARCELONA,
      lastChosenSelection: MADRID,
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.selection).toEqual(BARCELONA);
    expect(state.source).toBe('saved_area');
  });

  it('the last chosen area is restored when nothing above it applies', () => {
    const state = resolveLocationScope({ ...EMPTY, lastChosenSelection: MADRID });

    expect(state.selection).toEqual(MADRID);
    expect(state.source).toBe('last_chosen');
    expect(state.canQuery).toBe(true);
  });

  it('a new user with no saved searches, no permission and no network answer gets DISCOVERY', () => {
    const state = resolveLocationScope(EMPTY);

    expect(state.selection).toBeNull();
    expect(state.discovery).toBe(true);
    expect(state.canQuery).toBe(false);
    expect(state.isGlobal).toBe(false);
    // Never presented as a guess, because there is nothing to guess.
    expect(state.isApproximate).toBe(false);
  });

  it('a new user with a network answer is placed, with no prompt anywhere', () => {
    const state = resolveLocationScope({ ...EMPTY, approximate: IP_RESOLVED });

    expect(state.selection).toEqual(BUCHAREST);
    expect(state.source).toBe('ip');
    expect(state.canQuery).toBe(true);
    expect(state.discovery).toBe(false);
    expect(state.isApproximate).toBe(true);
  });

  it('every explicit rung outranks the network', () => {
    for (const [key, source] of [
      ['sessionSelection', 'session'],
      ['savedAreaSelection', 'saved_area'],
      ['lastChosenSelection', 'last_chosen'],
    ] as const) {
      const state = resolveLocationScope({ ...EMPTY, [key]: MADRID, approximate: IP_RESOLVED });
      expect(state.selection).toEqual(MADRID);
      expect(state.source).toBe(source);
      // A chosen area is never disclosed as approximate.
      expect(state.isApproximate).toBe(false);
    }
  });

  it('a device fix outranks the network when both are the first answer', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      device: { status: 'resolved', selection: DEVICE_FIX },
      approximate: IP_RESOLVED,
    });

    expect(state.source).toBe('device');
    expect(state.selection).toEqual(DEVICE_FIX);
  });

  it('a region-level inference reports its granularity rather than claiming a city', () => {
    const region: ApproximatePositionState = {
      status: 'resolved',
      selection: BUCHAREST,
      granularity: 'region',
    };
    const state = resolveLocationScope({ ...EMPTY, approximate: region });

    expect(state.granularity).toBe('region');
  });

  it('an absent saved-area rung is a SKIP, not a failure', () => {
    // #356 has landed and the rung is live, but `null` is still its COMMON
    // answer: most people have never marked a primary area. The ladder must fall
    // through it silently rather than treating absence as a problem — otherwise
    // Home would break for everybody who has not set one.
    //
    // The case this does NOT cover is "still loading", which is deliberately not
    // expressible here: `useLocationScope` keeps the two apart and passes
    // `device: { status: 'resolving' }` while the rung is in flight, so the
    // ladder reports `resolving` instead of skipping to a scope it is about to
    // replace.
    const state = resolveLocationScope({
      ...EMPTY,
      savedAreaSelection: null,
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.source).toBe('device');
    expect(state.canQuery).toBe(true);
  });
});

describe('a late answer cannot overwrite a newer choice', () => {
  it('a device answer alongside a session choice loses to the choice', () => {
    // This is the "respuesta tardía" case with the timing removed: whenever the
    // device answer arrived, the ladder reads the session rung first, so the
    // device result is not something that CAN displace it.
    const state = resolveLocationScope({
      ...EMPTY,
      sessionSelection: BARCELONA,
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.selection).toEqual(BARCELONA);
    expect(state.source).toBe('session');
  });

  it('a device answer alongside a NEWER session choice for another city still loses', () => {
    // Madrid picked while Barcelona's device-derived scope was in flight.
    const state = resolveLocationScope({
      ...EMPTY,
      sessionSelection: MADRID,
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.selection).toEqual(MADRID);
    // The floor: without this the previous assertion would pass against a ladder
    // that returned the device scope and happened to be compared to it.
    expect(state.selection).not.toEqual(DEVICE_FIX);
  });
});

describe('"use my location" pressed while an area is in use', () => {
  // The store clears the session choice on that press, so these inputs are the
  // ones the ladder actually sees. Before this rung, the fix arrived and the
  // ladder kept reading the saved or last area — the row did nothing at all.
  it('the device fix outranks the saved and last-chosen areas', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      savedAreaSelection: BARCELONA,
      lastChosenSelection: MADRID,
      device: { status: 'resolved', selection: DEVICE_FIX },
      deviceRequested: true,
    });

    expect(state.selection).toEqual(DEVICE_FIX);
    expect(state.source).toBe('device');
  });

  it('while the fix is taken, it states progress — not the area it is about to replace', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      lastChosenSelection: MADRID,
      device: { status: 'resolving' },
      deviceRequested: true,
    });

    expect(state.resolution).toEqual({ status: 'resolving' });
    expect(state.selection).toBeNull();
    expect(state.canQuery).toBe(false);
    expect(state.isGlobal).toBe(false);
  });

  it('a failed fix falls back to the last area, reporting why — never to everywhere', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      lastChosenSelection: MADRID,
      device: { status: 'failed', reason: 'permission_denied' },
      deviceRequested: true,
    });

    expect(state.selection).toEqual(MADRID);
    expect(state.deviceIssue).toBe('permission_denied');
    expect(state.isGlobal).toBe(false);
  });

  it('a failed fix with no area to fall back to is discovery, not a barrier', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      device: { status: 'failed', reason: 'position_unavailable' },
      deviceRequested: true,
    });

    expect(state.discovery).toBe(true);
    expect(state.canQuery).toBe(false);
  });

  it('a session choice made AFTER the press still wins', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      sessionSelection: BARCELONA,
      device: { status: 'resolved', selection: DEVICE_FIX },
      deviceRequested: true,
    });

    expect(state.selection).toEqual(BARCELONA);
    expect(state.source).toBe('session');
  });
});

describe('global is reachable ONLY by the explicit flag', () => {
  it('the explicit flag yields a global scope that may be queried', () => {
    const state = resolveLocationScope({ ...EMPTY, explicitGlobal: true });

    expect(state.isGlobal).toBe(true);
    expect(state.selection).toBeNull();
    expect(state.canQuery).toBe(true);
    expect(state.source).toBe('global');
  });

  it('no OTHER combination of inputs reaches a global scope', () => {
    // The sweep, rather than three or four hand-picked cases: the acceptance
    // criterion is about every path, and enumerating them is the only way to
    // assert "every". Every rung crossed with every device state, with the flag
    // OFF throughout.
    const selections: (LocationSelection | null)[] = [null, BARCELONA, MADRID];
    const devices: DevicePositionState[] = [
      { status: 'idle' },
      { status: 'resolving' },
      { status: 'resolved', selection: DEVICE_FIX },
      { status: 'failed', reason: 'permission_denied' },
      { status: 'failed', reason: 'position_unavailable' },
      { status: 'failed', reason: 'network' },
      { status: 'failed', reason: 'rate_limited' },
      { status: 'failed', reason: 'no_results' },
      { status: 'failed', reason: 'ambiguous' },
      { status: 'failed', reason: 'unsupported' },
    ];

    const approximates: ApproximatePositionState[] = [
      { status: 'idle' },
      { status: 'resolving' },
      { status: 'unavailable' },
      IP_RESOLVED,
    ];

    let checked = 0;
    for (const deviceRequested of [false, true]) {
      for (const sessionSelection of selections) {
        for (const savedAreaSelection of selections) {
          for (const lastChosenSelection of selections) {
            for (const device of devices) {
              for (const approximate of approximates) {
                const state = resolveLocationScope({
                  explicitGlobal: false,
                  sessionSelection,
                  savedAreaSelection,
                  lastChosenSelection,
                  device,
                  approximate,
                  committedAuto: null,
                  deviceRequested,
                });
                expect(state.isGlobal).toBe(false);
                expect(state.source).not.toBe('global');
                // A scope-less state must never be queryable: that combination
                // IS the silent global feed, wearing a different flag.
                if (state.selection === null) expect(state.canQuery).toBe(false);
                checked += 1;
              }
            }
          }
        }
      }
    }

    // A vacuity floor. `expect` inside a loop that never runs passes silently,
    // and a broken generator is indistinguishable from a clean sweep without it.
    expect(checked).toBe(2 * selections.length ** 3 * devices.length * approximates.length);
    expect(checked).toBe(2160);
  });
});

describe('the mandatory picker is unreachable', () => {
  // The regression gate #518/#519 ask for: "Añadir pruebas de regresión que
  // fallen si se reintroduce el selector obligatorio."
  //
  // The ladder has no `needsPlace` field to reintroduce, so the gate is
  // expressed over what a barrier would MEAN: a state with no area that also
  // denies being discovery. Every such state is a screen that shows neither
  // homes nor destinations, which is the barrier by another name.
  it('every area-less state is either resolving or discovery', () => {
    const selections: (LocationSelection | null)[] = [null, BARCELONA];
    const devices: DevicePositionState[] = [
      { status: 'idle' },
      { status: 'resolving' },
      { status: 'resolved', selection: DEVICE_FIX },
      { status: 'failed', reason: 'permission_denied' },
      { status: 'failed', reason: 'position_unavailable' },
      { status: 'failed', reason: 'network' },
      { status: 'failed', reason: 'unsupported' },
    ];
    const approximates: ApproximatePositionState[] = [
      { status: 'idle' },
      { status: 'resolving' },
      { status: 'unavailable' },
      IP_RESOLVED,
    ];
    const commits: (CommittedAutoScope | null)[] = [
      null,
      { source: 'ip', selection: BUCHAREST },
      { source: 'device', selection: DEVICE_FIX },
    ];

    let checked = 0;
    for (const explicitGlobal of [false, true]) {
      for (const deviceRequested of [false, true]) {
        for (const sessionSelection of selections) {
          for (const device of devices) {
            for (const approximate of approximates) {
              for (const committedAuto of commits) {
                const state = resolveLocationScope({
                  explicitGlobal,
                  sessionSelection,
                  savedAreaSelection: null,
                  lastChosenSelection: null,
                  device,
                  approximate,
                  committedAuto,
                  deviceRequested,
                });
                if (state.selection === null && !state.isGlobal) {
                  expect({
                    discovery: state.discovery,
                    resolving: state.resolution.status === 'resolving',
                  }).toEqual(
                    expect.objectContaining({}),
                  );
                  expect(state.discovery || state.resolution.status === 'resolving').toBe(true);
                }
                checked += 1;
              }
            }
          }
        }
      }
    }

    expect(checked).toBe(
      2 * 2 * selections.length * devices.length * approximates.length * commits.length,
    );
  });
});

describe('a second automatic answer never moves the user', () => {
  it('a device fix arriving over a COMMITTED network scope becomes an offer', () => {
    // #518 §3.3 in one assertion: "Una vez mostrados resultados de una zona,
    // una respuesta automática tardía no debe mover el mapa y sustituirlos
    // inesperadamente."
    const state = resolveLocationScope({
      ...EMPTY,
      approximate: IP_RESOLVED,
      committedAuto: { source: 'ip', selection: BUCHAREST },
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.selection).toEqual(BUCHAREST);
    expect(state.source).toBe('ip');
    // Not discarded — offered.
    expect(state.upgrade).toEqual({ source: 'device', selection: DEVICE_FIX });
  });

  it('a network answer arriving over a COMMITTED device scope changes nothing', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      committedAuto: { source: 'device', selection: DEVICE_FIX },
      approximate: IP_RESOLVED,
    });

    expect(state.selection).toEqual(DEVICE_FIX);
    expect(state.source).toBe('device');
    // A network guess is not an improvement on a real fix, so nothing is
    // offered either — an offer nobody should accept is noise.
    expect(state.upgrade).toBeNull();
  });

  it('an explicit choice outranks a committed inference outright', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      sessionSelection: MADRID,
      committedAuto: { source: 'ip', selection: BUCHAREST },
      device: { status: 'resolved', selection: DEVICE_FIX },
    });

    expect(state.selection).toEqual(MADRID);
    expect(state.source).toBe('session');
    // No offer beside a chosen city: the device position is not an
    // "improvement" on a place somebody named, it is a different place.
    expect(state.upgrade).toBeNull();
  });

  it('no upgrade is offered while the device has not answered', () => {
    const state = resolveLocationScope({
      ...EMPTY,
      approximate: IP_RESOLVED,
      committedAuto: { source: 'ip', selection: BUCHAREST },
      device: { status: 'idle' },
    });

    expect(state.upgrade).toBeNull();
  });
});
