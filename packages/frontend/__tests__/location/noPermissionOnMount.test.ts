/**
 * The gate #518 and #519 ask for by name: nothing may request the location
 * permission because a component mounted.
 *
 * > "No hay permisos solicitados automáticamente desde Home, mapa u otros
 * > montajes de descubrimiento." (#518 §12)
 * > "Suprimir los permisos solicitados por montaje; «centrar en mí» llama al
 * > flujo explícito común." (#518 §8)
 *
 * ## Why a source gate and not a render test
 *
 * A render test can only prove that ONE screen, in ONE configuration, did not
 * prompt. The rule is about every screen in every configuration, and the way it
 * breaks is somebody adding an effect to a component nobody thought of as a
 * discovery surface. Two of the three call sites this gate was written against
 * were exactly that: `Map.tsx` prompted whenever it was mounted without initial
 * coordinates, and `useHomeFeed`'s `useUserCoordinates` prompted because
 * `/explore` mounts it to BIAS place suggestions — a refinement nobody asked
 * for, paid for with a system dialog.
 *
 * ## The allow-list is two entries and must stay that way
 *
 * A prompt is legitimate when it answers a press. Both survivors do:
 *
 *  - `hooks/useLocationScope.ts` — "use my location" in the search bar's panel.
 *    It is the app-wide owner of the permission, and it prompts only when
 *    `mayPrompt` is true, which only the button sets.
 *  - `hooks/usePropertyCreateForm.ts` — "use my location" in the publish
 *    wizard's address step, inside a mutation a button fires.
 *
 * Anything else added here has to explain, in this file, which press it answers.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { stripComments } from '@homiio/shared-types/testing/stripComments';

/** Repository root — three levels up from `packages/frontend/__tests__/location`. */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const FRONTEND_PACKAGE = 'packages/frontend';

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * The calls that show a LOCATION dialog.
 *
 * `getForegroundPermissionsAsync` is deliberately NOT here: reading the current
 * answer shows nothing and is what every discovery surface should do instead.
 * That distinction is the entire fix, and a gate that banned both would have
 * forced the surfaces to stop using an already-granted permission, which helps
 * nobody.
 *
 * The two `Foreground`/`Background` names belong to expo-location alone, so
 * they are matched outright. The bare `requestPermissionsAsync` is NOT: it is
 * also expo-notifications' and expo-av's, and this gate has nothing to say
 * about a microphone or a push token. It counts only in a file that imports
 * expo-location — see {@link locationPromptsIn}.
 */
const LOCATION_ONLY_CALLS = [
  'requestForegroundPermissionsAsync',
  'requestBackgroundPermissionsAsync',
];

/** expo-location's DEPRECATED combined request. Shared name, so it needs context. */
const AMBIGUOUS_CALL = 'requestPermissionsAsync';

/**
 * Which location prompts a file contains.
 *
 * `code` must already be comment-stripped. The ambiguity rule is the whole
 * reason this is a function: a gate that banned `requestPermissionsAsync`
 * outright failed on the speech engine and the notification registration, which
 * are not location at all — and the natural next move, adding them to the
 * allow-list, would have quietly granted them a location exemption they do not
 * need and should never have.
 */
function locationPromptsIn(code: string): string[] {
  const found = LOCATION_ONLY_CALLS.filter((call) => code.includes(call));
  if (code.includes('expo-location') && code.includes(AMBIGUOUS_CALL)) {
    found.push(AMBIGUOUS_CALL);
  }
  return found;
}

/** Files allowed to prompt, each answering a press. See the header. */
const ALLOWED: ReadonlyArray<{ path: string; why: string }> = [
  {
    path: 'packages/frontend/hooks/useLocationScope.ts',
    why: 'the app-wide owner; prompts only when "use my location" sets mayPrompt',
  },
  {
    path: 'packages/frontend/hooks/usePropertyCreateForm.ts',
    why: 'the publish wizard address step, inside a mutation a button fires',
  },
];

function trackedFiles(pathspec: string): string[] {
  const output = execFileSync('git', ['ls-files', '-z', '--', pathspec], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return output
    .split('\0')
    .filter((file) => file.length > 0)
    .filter((file) => SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension)));
}

describe('no location permission is requested because something mounted', () => {
  const files = trackedFiles(FRONTEND_PACKAGE);
  const allowed = new Set(ALLOWED.map((entry) => entry.path));

  it('scanned a non-trivial number of files', () => {
    // A vacuity floor: a broken pathspec produces an empty list, which is
    // indistinguishable from a clean tree without this.
    expect(files.length).toBeGreaterThan(200);
  });

  it('only the allow-listed files call a permission-requesting API', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (allowed.has(file)) continue;
      // Tests are excluded: a test that asserts the prompt is NOT called has to
      // name it to spy on it.
      if (file.includes('/__tests__/')) continue;

      let source: string;
      try {
        source = readFileSync(join(REPO_ROOT, file), 'utf8');
      } catch (error) {
        // A tracked file this cannot read is a FAILURE, not a skip: an unread
        // file is exactly where a reintroduction would hide.
        offenders.push(`${file} (unreadable: ${String(error)})`);
        continue;
      }

      // Comments are stripped: several modules explain what they no longer do
      // in precisely this vocabulary, including this file's own header.
      for (const call of locationPromptsIn(stripComments(source))) {
        offenders.push(`${file} calls ${call}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the allow-listed files still exist and still prompt', () => {
    // Without this, the gate passes trivially once somebody renames or deletes
    // the two legitimate call sites — and a gate that cannot tell "clean" from
    // "measuring nothing" is the failure mode this whole file is shaped against.
    for (const entry of ALLOWED) {
      const code = stripComments(readFileSync(join(REPO_ROOT, entry.path), 'utf8'));
      expect({ path: entry.path, prompts: locationPromptsIn(code).length > 0 }).toEqual({
        path: entry.path,
        prompts: true,
      });
    }
  });

  it('the discovery surfaces READ the permission instead', () => {
    // The positive half: the maps and the suggestion bias must still use a
    // position the user already granted. A gate that only forbade prompting
    // would be satisfied by deleting the feature.
    for (const path of [
      'packages/frontend/components/Map.tsx',
      'packages/frontend/components/Map.web.tsx',
      'packages/frontend/hooks/useHomeFeed.ts',
    ]) {
      const code = stripComments(readFileSync(join(REPO_ROOT, path), 'utf8'));
      expect({ path, reads: code.includes('getForegroundPermissionsAsync') }).toEqual({
        path,
        reads: true,
      });
    }
  });
});
