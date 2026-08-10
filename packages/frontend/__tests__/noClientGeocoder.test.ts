/**
 * The gate issue #351 asks for: a mutation that reintroduces a Nominatim call
 * from the frontend must FAIL, and must name the file that did it.
 *
 * The rule it enforces is ADR 0002 §9.1 — "the client never talks to a
 * geocoder" — and the reasons are worth restating here, because the code this
 * replaced looked perfectly reasonable and shipped for a long time:
 *
 *  - a per-device call cannot be rate-limited, cached or attributed, and the
 *    OSM usage policy counts every one of them against Homiio;
 *  - the client sends a user's typing, and sometimes their position, straight
 *    to a third party on a network path Homiio does not control;
 *  - a browser refuses to let JavaScript set `User-Agent` at all, so web and
 *    native behaved differently against a provider that rejects requests
 *    without one — native returned zero suggestions for months;
 *  - swapping provider meant editing app code already shipped to phones.
 *
 * ## Two rules, and the second is not redundant
 *
 * **Rule 1 — the frontend calls no geocoder at all.** Zero allow-list: there is
 * no legitimate reason for a screen to name a geocoding host, and an
 * allow-listed exception here would be the whole bug wearing a permission slip.
 *
 * **Rule 2 — exactly ONE backend file names a geocoding host, and it is the
 * config default.** A second adapter hardcoding a provider URL next to the
 * first would satisfy rule 1 completely and still put Homiio back over the
 * provider's rate limit, so the backend's mentions are allow-listed by path and
 * the list is meant to shrink, never grow.
 *
 * What rule 2 does NOT claim, because a host scan cannot see it: that only one
 * adapter is REGISTERED. An adapter that read its base URL from configuration
 * (as `nominatimProvider.ts` correctly does — which is why it is not on the
 * list below) would be invisible here. That property is enforced by the
 * registry's own tests, not by this file.
 *
 * ## Design notes, because every failure mode of a scan like this is silent
 *
 * These follow `__tests__/noHardcodedCurrency.test.ts`, which is this repo's
 * reference implementation for the shape:
 *
 *  - **Enumeration is `git ls-files`**, not a directory walk: build output is
 *    excluded for free rather than by an ignore list that rots, and the file
 *    set cannot disagree with what git tracks. Note the consequence for anyone
 *    mutation-testing this gate: an UNSTAGED probe is not in the index and
 *    therefore not in the scan, so a planted file must be `git add -f`ed or the
 *    mutation measures nothing and "passes".
 *  - **Directory pathspecs**, never a doubled-star glob ending in an extension
 *    — that form matches only files in a SUBdirectory and silently drops every
 *    top-level one, which reads exactly like a clean result. (It cannot be
 *    written out here: the glob contains the character pair that ends a block
 *    comment, and doing so terminated this header early and broke the parse.)
 *  - **An AFFIRMATIVE extension list** covering `.ts`, `.tsx` and `.js` (plus
 *    the rest), because an extension filter narrower than the languages present
 *    is one of the ways this exact check ends up measuring nothing.
 *  - **A vacuity floor** on files scanned. `expect([]).toEqual([])` is what a
 *    BROKEN traversal produces and is indistinguishable from a clean tree
 *    without one.
 *  - **A pinned predicate case**, so a scan that stopped matching anything at
 *    all fails instead of passing — and a negative case beside it, so the gate
 *    does not cry wolf and get switched off by whoever hits it next.
 *  - **A tracked-but-unreadable file is a FAILURE, not a skip.** An unread file
 *    is exactly where a reintroduction would hide.
 *
 * Comments are stripped before matching, deliberately and for a reason that has
 * already bitten this repo twice: several modules here explain what they no
 * longer do in exactly the forbidden vocabulary (this file's own header names
 * the host four times), and a comment renders to nobody and calls nothing. It
 * is the same call `packages/backend/__tests__/unit/mongoUnreachable.test.ts`
 * and `noHardcodedCurrency.test.ts` both make.
 *
 * The stripping itself comes from `@homiio/shared-types/testing/stripComments`
 * (#388) rather than being implemented here. This gate briefly carried its own,
 * written after the two regexes it replaced were caught reporting a clean tree
 * against a tree holding six live Nominatim calls; #388 generalised that fix and
 * added regex-literal and template-interpolation tracking, so there is one
 * implementation and one place to fix the next hole in it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { stripComments } from '@homiio/shared-types/testing/stripComments';

/** Repository root — two levels up from `packages/frontend`. */
const REPO_ROOT = join(__dirname, '..', '..', '..');

const FRONTEND_PACKAGE = 'packages/frontend';
const BACKEND_PACKAGE = 'packages/backend';

/**
 * Extensions that must be clean. Affirmative on purpose: a `.vue` or `.svelte`
 * arriving tomorrow is not silently exempt, it is simply not yet covered, and
 * adding it here is a visible decision.
 */
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Geocoding endpoints no client may contact.
 *
 * Deliberately BROADER than the one host the issue names. The rule is "the
 * client never talks to a geocoder", not "the client never talks to this
 * particular geocoder" — swapping the direct call to Photon or Mapbox would
 * satisfy the narrow reading and reproduce every problem listed above.
 *
 * Map TILE hosts are NOT here and must not be added: `tiles.openfreemap.org`
 * serves basemap tiles, which the client is supposed to fetch directly.
 * `maps.google.com` is likewise absent — the app links to it to hand a user off
 * to their maps application, which is a deep link, not an API call.
 * `www.openstreetmap.org` is absent for the same reason: it is the ODbL
 * attribution link that the licence REQUIRES the client to render.
 */
const GEOCODER_HOSTS: ReadonlyArray<{ pattern: string; why: string }> = [
  { pattern: 'nominatim.openstreetmap.org', why: 'OSM Nominatim (the public instance)' },
  { pattern: 'photon.komoot.io', why: 'Photon geocoder' },
  { pattern: 'api.opencagedata.com', why: 'OpenCage geocoder' },
  { pattern: 'geocode.maps.co', why: 'maps.co geocoder' },
  { pattern: 'api.mapbox.com/geocoding', why: 'Mapbox geocoding API' },
  { pattern: 'api.mapbox.com/search', why: 'Mapbox search/autocomplete API' },
  { pattern: 'maps.googleapis.com/maps/api/geocode', why: 'Google geocoding API' },
  { pattern: 'maps.googleapis.com/maps/api/place', why: 'Google Places autocomplete API' },
  { pattern: 'api.geoapify.com', why: 'Geoapify geocoder' },
  { pattern: 'api.locationiq.com', why: 'LocationIQ geocoder' },
];

/**
 * The ONLY backend files permitted to name a geocoding host.
 *
 * Each entry must be justified beside it. Keeping this list shrinking is the
 * point; an entry added without a reason is the failure this gate exists to
 * prevent, one level up.
 *
 * ONE entry is the whole surface of Homiio's relationship with a geocoding
 * provider, and that is a stronger statement than it looks. The Nominatim
 * adapter itself is deliberately absent: it reads `nominatimBaseUrl` from
 * configuration and names no host in code, so allow-listing it would have been
 * a stranded exemption. The assertion below that every entry still MATCHES is
 * what caught that while this list was being written.
 */
const BACKEND_ALLOWED: ReadonlyArray<{ path: string; why: string }> = [
  {
    // The configured base URL, and the only default. Pointing this at a
    // self-hosted instance is how the public endpoint stops being used at all,
    // which is precisely why it has to be a config value and not a literal in
    // the adapter.
    path: 'packages/backend/config.ts',
    why: 'NOMINATIM_BASE_URL default — the swap point for a self-hosted instance',
  },
];

/**
 * Floors, sized against the tree at the time of writing (524 frontend and 403
 * backend tracked source files) with room to shrink. A number this far below
 * the real count cannot be tripped by ordinary deletion, and a traversal that
 * broke entirely returns zero.
 */
const MINIMUM_FRONTEND_FILES = 400;
const MINIMUM_BACKEND_FILES = 300;

/** One offending line, reported with enough context to act on. */
interface Finding {
  file: string;
  line: number;
  text: string;
  host: string;
}

/** Every line of `source` that names a geocoding endpoint. */
function scanSource(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  stripComments(source)
    .split('\n')
    .forEach((text, index) => {
      for (const { pattern } of GEOCODER_HOSTS) {
        if (text.includes(pattern)) {
          findings.push({ file, line: index + 1, text: text.trim(), host: pattern });
        }
      }
    });
  return findings;
}

/** Tracked source files under `pathspec`, by repo-relative path. */
function trackedSourceFiles(pathspec: string): string[] {
  const output = execFileSync('git', ['ls-files', '--', pathspec], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return (
    output
      .split('\n')
      .filter(Boolean)
      .filter((file) => SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension)))
      // This file names every forbidden host in order to forbid them, so it
      // cannot scan itself.
      .filter((file) => !file.endsWith('__tests__/noClientGeocoder.test.ts'))
  );
}

/** Read every file, recording the ones git tracks but the tree does not have. */
function scanFiles(files: string[], skip: ReadonlySet<string>): {
  findings: Finding[];
  unreadable: string[];
} {
  const findings: Finding[] = [];
  const unreadable: string[] = [];
  for (const file of files) {
    if (skip.has(file)) continue;
    let source: string;
    try {
      source = readFileSync(join(REPO_ROOT, file), 'utf8');
    } catch {
      unreadable.push(file);
      continue;
    }
    findings.push(...scanSource(file, source));
  }
  return { findings, unreadable };
}

const describeFinding = (finding: Finding): string =>
  `${finding.file}:${finding.line}  [${finding.host}]  ${finding.text}`;

describe('the client never talks to a geocoder', () => {
  const frontendFiles = trackedSourceFiles(FRONTEND_PACKAGE);
  const backendFiles = trackedSourceFiles(BACKEND_PACKAGE);

  it('scans enough files that a broken traversal cannot pass as clean', () => {
    // `expect([]).toEqual([])` is exactly what a broken `git ls-files` produces,
    // and it is indistinguishable from a clean tree without this.
    expect(frontendFiles.length).toBeGreaterThan(MINIMUM_FRONTEND_FILES);
    expect(backendFiles.length).toBeGreaterThan(MINIMUM_BACKEND_FILES);
  });

  it('scans top-level files, not only nested ones', () => {
    // A doubled-star pathspec silently drops every top-level file while
    // returning a plausible-looking list. `packages/backend/config.ts` is
    // top-level and IS one of the allow-listed hits, so its absence would make
    // the allow-list assertion below vacuous rather than loud.
    expect(backendFiles).toContain('packages/backend/config.ts');
    expect(frontendFiles.some((file) => file.split('/').length === 3)).toBe(true);
  });

  it('can still recognise a geocoder call, and does not flag a tile or a link', () => {
    // Pinned predicate: if this stops matching, every other assertion here has
    // quietly become vacuous.
    const offending = [
      "const r = await fetch('https://nominatim.openstreetmap.org/search?q=' + q);",
      "await fetch(`https://photon.komoot.io/api/?q=${q}`);",
      "fetch('https://maps.googleapis.com/maps/api/geocode/json?address=' + a);",
    ].join('\n');
    expect(scanSource('probe.ts', offending).map((finding) => finding.host)).toEqual([
      'nominatim.openstreetmap.org',
      'photon.komoot.io',
      'maps.googleapis.com/maps/api/geocode',
    ]);

    // And the legitimate neighbours must NOT match. A gate that flags the
    // basemap or the licence-mandated attribution link gets switched off.
    expect(
      scanSource(
        'probe.tsx',
        [
          "const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';",
          "<A href='https://www.openstreetmap.org/copyright'>© OpenStreetMap</A>",
          "Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`);",
          "const places = await api.get('/api/geo/search', { params: { q } });",
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('strips comments without blinding itself — both measured regressions', () => {
    // (1) Truncating at the first `//` deletes the host out of `https://…`.
    // This one made every rule here match nothing while the tree held six live
    // calls, and the whole gate reported clean.
    expect(stripComments("const U = 'https://nominatim.openstreetmap.org/search';")).toContain(
      'nominatim.openstreetmap.org',
    );

    // (2) A block-comment OPENER mentioned inside a line comment is not an
    // opener. `packages/backend/config.ts:390` does exactly this, and a
    // non-greedy regex blanked the following 112 lines of real code — which
    // included the single backend line naming the geocoding host.
    const openerInLineComment = [
      '// the sequence /' + '* used to break this scanner',
      "const U = 'https://nominatim.openstreetmap.org/search';",
    ].join('\n');
    expect(stripComments(openerInLineComment)).toContain('nominatim.openstreetmap.org');

    // …while real comments of both kinds are still removed.
    expect(stripComments('const a = 1; // https://nominatim.openstreetmap.org')).not.toContain(
      'nominatim.openstreetmap.org',
    );
    expect(
      stripComments('/' + '* https://nominatim.openstreetmap.org *' + '/ const a = 1;'),
    ).not.toContain('nominatim.openstreetmap.org');

    // And line numbering survives, or every finding points at the wrong line.
    expect(stripComments('a\n/' + '*\nx\n*' + '/\nb').split('\n')).toHaveLength(5);
  });

  it('strips comments, so prose about the rule is not a violation of it', () => {
    // Every module that used to call the geocoder now explains that it does
    // not, in exactly this vocabulary. Without stripping, documenting the fix
    // would break the gate that guards it.
    expect(
      scanSource(
        'probe.ts',
        [
          '// Geocoding goes through /api/geo, never nominatim.openstreetmap.org directly.',
          '/* was: fetch("https://nominatim.openstreetmap.org/reverse") */',
          'const url = buildGatewayUrl();',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('every backend allow-list entry names a file that is actually scanned', () => {
    // An entry left behind after its file was deleted or renamed is a stranded
    // exemption nobody will notice; make it fail here instead. This is also the
    // half of the "two halves of one fact land in one commit" rule that a
    // deletion would otherwise strand.
    for (const entry of BACKEND_ALLOWED) {
      expect(backendFiles).toContain(entry.path);
    }
  });

  it('every backend allow-list entry still names a geocoder, or it is dead', () => {
    // The mirror of the assertion above: an entry whose file no longer mentions
    // a geocoder is an exemption that has outlived its reason, and leaving it
    // there quietly widens the permitted surface for whoever edits that file
    // next.
    for (const entry of BACKEND_ALLOWED) {
      const source = readFileSync(join(REPO_ROOT, entry.path), 'utf8');
      expect(scanSource(entry.path, source).length).toBeGreaterThan(0);
    }
  });

  it('finds no geocoder endpoint anywhere in the frontend', () => {
    // The acceptance criterion of #351, verbatim: zero calls to a public
    // geocoder from the frontend. No allow-list — there is no legitimate
    // exception, and an exception here would be the bug with a permission slip.
    const { findings, unreadable } = scanFiles(frontendFiles, new Set());

    expect(unreadable).toEqual([]);
    expect(findings.map(describeFinding)).toEqual([]);
  });

  it('finds no geocoder endpoint in the backend outside the two allowed files', () => {
    // The gateway is a chokepoint only while there is ONE client behind it.
    const allowed = new Set(BACKEND_ALLOWED.map((entry) => entry.path));
    const { findings, unreadable } = scanFiles(backendFiles, allowed);

    expect(unreadable).toEqual([]);
    expect(findings.map(describeFinding)).toEqual([]);
  });
});
