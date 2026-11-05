/**
 * Android App Links for `https://homiio.com/...`: the
 * `/.well-known/assetlinks.json` the verifier fetches before it lets the app own
 * the `autoVerify` filter in `app.config.js`.
 *
 * It is served HERE, by the `homiio-frontend` Worker, because `homiio.com` is
 * this Worker and nothing else (`wrangler.toml`). Without this module the assets
 * binding's single-page-application fallback answered the path with `index.html`
 * and status 200, which Android does not accept, so no https link opened the
 * app. Every other `/.well-known/` path ends in a JSON 404 as well, so a missing
 * document can never masquerade as the app shell. The shape mirrors Allo's
 * `worker/appAssociation.js`.
 *
 * The verifier requires the document at exactly this path, with no redirect and
 * a JSON body. `__tests__/appAssociation.test.ts` pins the package below to
 * `app.config.js`, so renaming the app cannot silently break verification.
 */

/** `android.package` of the production app (`app.config.js`). */
export const ANDROID_PACKAGE = 'com.homiio.app';

/**
 * The Oxy ecosystem release key (`CN=Oxy, OU=Oxy Ecosystem`, alias `oxy`). Every
 * Oxy app is signed with it (the release workflow fails any build without it,
 * and Play App Signing uses it as the app signing key), so it is the only
 * certificate a Homiio install carries.
 */
export const OXY_RELEASE_CERT_SHA256 =
  'B8:AB:37:46:46:6C:E4:56:9D:7A:6A:0F:FA:1E:ED:91:BC:37:51:74:D5:03:61:39:87:CA:09:CB:33:D6:A5:8D';

export const ASSET_LINKS_PATH = '/.well-known/assetlinks.json';

/** Verifiers re-fetch on their own schedule; an hour keeps a key rotation quick. */
const CACHE_CONTROL = 'public, max-age=3600';

export function buildAssetLinks() {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: [OXY_RELEASE_CERT_SHA256],
      },
    },
  ];
}

function json(body, status, cacheControl, method) {
  return new Response(method === 'HEAD' ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * The response for a `/.well-known/` request, or `null` for any other path,
 * which the caller hands to the assets binding as before.
 */
export function handleWellKnown(request) {
  const { pathname } = new URL(request.url);
  if (pathname !== '/.well-known' && !pathname.startsWith('/.well-known/')) return null;

  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    const response = json({ error: 'Method not allowed' }, 405, 'no-store', method);
    response.headers.set('Allow', 'GET, HEAD');
    return response;
  }

  if (pathname === ASSET_LINKS_PATH) {
    return json(buildAssetLinks(), 200, CACHE_CONTROL, method);
  }
  return json({ error: 'Not found' }, 404, 'no-store', method);
}
