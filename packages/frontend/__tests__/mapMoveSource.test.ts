/**
 * Both map adapters report WHO moved the camera — and this is the file that can
 * see the native one.
 *
 * #354 requires the tests to cover the web and the native map adapter. They are
 * not the same kind of artefact and cannot be checked the same way:
 *
 *  - **Web** drives a live `maplibre-gl` instance. It cannot be exercised under
 *    jsdom (no WebGL), so what is asserted here is the property that decides
 *    the outcome: every camera command in `Map.web.tsx` carries
 *    `PROGRAMMATIC_MOVE`. A command that does not is reported as a user gesture
 *    and arms "Search this area" over a viewport nobody chose.
 *  - **Native** drives a WebView whose whole program is a template literal in
 *    `mapDocument.ts`. It cannot be imported, typechecked or unit-tested as
 *    code — the ONLY thing a test can do is read the string it produces, so
 *    that is what this does.
 *
 * The document is also where the two halves of the protocol could silently
 * disagree: the host reads `homiioProgrammatic` off the event, the document
 * writes it, and the document cannot import the constant. Nothing but a test
 * that reads both makes that agreement real.
 *
 * ## Design notes, because a scan like this fails silently
 *
 * Following `noHardcodedCurrency.test.ts`, this repo's reference for the shape:
 * a VACUITY FLOOR on how much was scanned (a regex that stopped matching
 * anything reads exactly like a clean result), and a PINNED PREDICATE case so
 * a broken matcher fails instead of passing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROGRAMMATIC_MOVE, moveSourceOf } from '@/components/mapTypes';
import { buildMapDocument } from '@/components/mapDocument';

const MARKER_KEY = 'homiioProgrammatic';

const WEB_MAP_PATH = join(__dirname, '..', 'components', 'Map.web.tsx');
const webMapSource = readFileSync(WEB_MAP_PATH, 'utf8');

/**
 * Every MapLibre call that moves the camera, and `resize`, which fires
 * `movestart`/`move`/`moveend` too — that one lands as the split layout settles
 * on first paint, which is exactly the "an initial programmatic move must not
 * show the button" case.
 */
const CAMERA_COMMANDS = /\bmap(?:Ref\.current)?\??\.(easeTo|flyTo|jumpTo|fitBounds|resize)\(/g;

describe('moveSourceOf', () => {
  it('reads the marker a camera command attaches', () => {
    expect(moveSourceOf(PROGRAMMATIC_MOVE)).toBe('programmatic');
  });

  it('treats an unmarked event as a gesture', () => {
    // The safe direction: an unmarked command shows a button that need not be
    // there, where the opposite reading would hide it for good and look like
    // the feature was never built.
    expect(moveSourceOf({ type: 'moveend' })).toBe('user');
    expect(moveSourceOf(undefined)).toBe('user');
    expect(moveSourceOf(null)).toBe('user');
  });

  it('accepts only the literal marker, not anything truthy under that name', () => {
    // A fixture in the shape that makes a strict and a loose read disagree.
    // `Boolean(event.homiioProgrammatic)` would pass every case above and this
    // is the one that separates them.
    expect(moveSourceOf({ [MARKER_KEY]: 'yes' })).toBe('user');
  });
});

describe('the web adapter marks every camera command', () => {
  const matches = [...webMapSource.matchAll(CAMERA_COMMANDS)];

  it('found the commands at all', () => {
    // Vacuity floor. `expect([]).toEqual([])` is what a broken regex produces,
    // and it is indistinguishable from a clean file without this. Six were
    // present when this was written (a cluster expansion, a device-position
    // ease, `navigateToLocation`, the degenerate-box fallback, `fitBounds` and
    // the resize observer).
    expect(matches.length).toBeGreaterThanOrEqual(6);
  });

  it.each(['easeTo', 'fitBounds', 'jumpTo', 'resize'])(
    'has a pinned case for %s so the matcher cannot rot',
    (method) => {
      expect(CAMERA_COMMANDS.test(`map.${method}(`)).toBe(true);
      CAMERA_COMMANDS.lastIndex = 0;
    },
  );

  it('passes PROGRAMMATIC_MOVE to each one', () => {
    // The whole call is read, not the line it starts on: these are multi-line,
    // and a line-based check would answer about the opening parenthesis.
    const unmarked = matches
      .map((match) => {
        const call = webMapSource.slice(match.index, match.index + 400);
        return call.includes('PROGRAMMATIC_MOVE') ? null : `${match[1]} at index ${match.index}`;
      })
      .filter((entry): entry is string => entry !== null);

    expect(unmarked).toEqual([]);
  });
});

describe('the native document', () => {
  const document = buildMapDocument({
    center: [2.1686, 41.3874],
    zoom: 12,
    style: 'https://tiles.example/style.json',
    markerStyle: { chipBg: '#000', chipText: '#fff', onMarkerZoom: 14 },
    cluster: { enabled: true, radius: 50, maxZoom: 14, color: '#000', textColor: '#fff' },
    enableAddressLookup: false,
  });

  it('declares the marker under the SAME key the host reads', () => {
    // The host and the document cannot share a module — one is TypeScript, the
    // other is a string that becomes a program inside a WebView. This is the
    // only thing that makes them agree, so it reads the key off the exported
    // constant rather than repeating the literal.
    expect(Object.keys(PROGRAMMATIC_MOVE)).toEqual([MARKER_KEY]);
    expect(document).toContain(`const PROGRAMMATIC_MOVE = { ${MARKER_KEY}: true }`);
  });

  it('stamps every region message with a source', () => {
    expect(document).toContain(
      `const source = (ev && ev.${MARKER_KEY} === true) ? 'programmatic' : 'user'`,
    );
    expect(document).toContain('source: source');
  });

  it('forwards the causing event into the emitter', () => {
    // Without this the emitter has nothing to read the marker off and every
    // movement reports 'user', including the frame that opens the search.
    expect(document).toContain("map.on(ev, (e) => { emit(false, e); })");
    expect(document).toContain("map.on(ev, (e) => { emit(true, e); })");
  });

  it('marks each of its own camera commands', () => {
    const commands = [...document.matchAll(/map\.(easeTo|jumpTo|fitBounds)\(/g)];
    // Vacuity floor: a cluster expansion, a `setView` jump, a `setView` ease
    // and a `fitBounds` were present when this was written.
    expect(commands.length).toBeGreaterThanOrEqual(4);

    const unmarked = commands
      .map((match) => {
        const call = document.slice(match.index, match.index + 300);
        return call.includes('PROGRAMMATIC_MOVE') ? null : `${match[1]} at index ${match.index}`;
      })
      .filter((entry): entry is string => entry !== null);

    expect(unmarked).toEqual([]);
  });
});
