import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Backend port used by the API and the realtime socket in development.
 */
const DEV_API_PORT = 4000;

/**
 * Hosts that resolve to "the device itself" and therefore can never reach a
 * backend running on the developer machine from a native device/emulator.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/**
 * The Android emulator cannot reach the host machine via `localhost`/`127.0.0.1`
 * (that points at the emulated device's own loopback). Google maps the host
 * machine's loopback to the special alias `10.0.2.2` from inside the emulator.
 * See https://developer.android.com/studio/run/emulator-networking
 */
const ANDROID_EMULATOR_HOST_ALIAS = '10.0.2.2';

/**
 * Reads the dev-server host:port that Metro is being served from. During
 * development with `@expo/cli`, `expoConfig.hostUri` is populated; in Expo Go it
 * may instead live on `expoGoConfig.debuggerHost`. Both are typed as
 * `string | undefined` so no casting is required. On web (and in production
 * builds) both are absent and this returns `undefined`.
 */
function getMetroHostUri(): string | undefined {
  return Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? undefined;
}

/**
 * Resolves the host that should serve the dev backend on `:4000`.
 *
 * Metro reports a `host:port` URI such as `192.168.1.20:8081` or
 * `localhost:8081`. We keep only the host portion and reuse it for the backend:
 * - A real LAN address (e.g. `192.168.1.20`) is reachable from physical devices
 *   on the same network, so we use it verbatim.
 * - A loopback host means Metro was reached over the device's own loopback
 *   (typically the Android emulator via `adb reverse`). On Android we rewrite it
 *   to `10.0.2.2` (the emulator's documented alias for the host machine's
 *   loopback); on iOS/web `localhost` already points at the right machine.
 */
function resolveDevHost(): string {
  const hostUri = getMetroHostUri();
  // `hostUri` looks like "192.168.1.20:8081" — strip the port. On web it is
  // undefined, so we fall back to `localhost` (which is the user's own machine).
  const host = hostUri?.split(':')[0];

  if (host && !LOOPBACK_HOSTS.has(host)) {
    // Real LAN address from Metro → reachable from physical devices.
    return host;
  }

  // Metro was reached over loopback. Only the Android emulator needs the
  // `10.0.2.2` alias to escape its own loopback and reach the host machine.
  return Platform.OS === 'android' ? ANDROID_EMULATOR_HOST_ALIAS : 'localhost';
}

/**
 * Builds the dev API base URL for the given scheme. Pure, computed once at
 * module load. In production (`__DEV__` === false) callers keep the existing
 * `localhost` fallback instead — there is no production domain decided yet.
 */
function buildDevUrl(scheme: 'http' | 'ws'): string {
  return `${scheme}://${resolveDevHost()}:${DEV_API_PORT}`;
}

/**
 * REST API base URL.
 *
 * 1. `EXPO_PUBLIC_API_URL` wins if set (overridable in any environment; the
 *    `EXPO_PUBLIC_` prefix is what makes it survive into the client bundle).
 * 2. In dev, derive the host Metro is served from so native devices/emulators
 *    hit the developer machine instead of their own `localhost`.
 * 3. In production, fall back to the deployed API domain.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (__DEV__ ? buildDevUrl('http') : 'https://api.homiio.com');

export const OXY_BASE_URL =
  process.env.EXPO_PUBLIC_OXY_API_URL ||
  process.env.EXPO_PUBLIC_OXY_BASE_URL ||
  (__DEV__ ? 'http://192.168.86.44:3001' : 'https://api.oxy.so');

/**
 * Homiio's registered Oxy OAuth public client id. Required by `OxyProvider`
 * for device sign-in. Overridable via `EXPO_PUBLIC_OXY_CLIENT_ID`; the fallback
 * is the real registered public client id for Homiio.
 */
export const OXY_CLIENT_ID =
  process.env.EXPO_PUBLIC_OXY_CLIENT_ID ||
  'oxy_dk_85244d70394ab6e4ef62b6f2ff7e399e6e857464362c13bc';
