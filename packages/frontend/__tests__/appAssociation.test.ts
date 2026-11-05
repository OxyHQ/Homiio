import path from 'node:path';

// The Worker is plain JS outside this project's TypeScript program (it is not in
// `tsconfig.json`'s file list), so it is loaded with `require` and typed here.
const { ANDROID_PACKAGE, ASSET_LINKS_PATH, OXY_RELEASE_CERT_SHA256, handleWellKnown } =
  require('../worker/appAssociation.js') as {
    ANDROID_PACKAGE: string;
    ASSET_LINKS_PATH: string;
    OXY_RELEASE_CERT_SHA256: string;
    handleWellKnown: (request: Request) => Response | null;
  };

/**
 * `homiio.com` ANSWERS THE APP LINKS VERIFIER WITH JSON, NOT THE APP SHELL.
 *
 * The Worker's assets binding answers any unknown path with `index.html` and
 * 200, so until `worker/appAssociation.js` existed the assetlinks document was
 * the SPA and no https link could open the app.
 */

const ORIGIN = 'https://homiio.com';

function request(pathname: string, method = 'GET'): Response | null {
  return handleWellKnown(new Request(`${ORIGIN}${pathname}`, { method }));
}

/** A path the Worker answers itself. */
function get(pathname: string, method = 'GET'): Response {
  const response = request(pathname, method);
  if (!response) throw new Error(`${pathname} fell through to the assets binding`);
  return response;
}

describe('assetlinks.json', () => {
  it('is 200 application/json naming the production package and the Oxy release key', async () => {
    const response = get(ASSET_LINKS_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.homiio.app',
          sha256_cert_fingerprints: [
            'B8:AB:37:46:46:6C:E4:56:9D:7A:6A:0F:FA:1E:ED:91:BC:37:51:74:D5:03:61:39:87:CA:09:CB:33:D6:A5:8D',
          ],
        },
      },
    ]);
    expect(OXY_RELEASE_CERT_SHA256).toMatch(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it('answers HEAD with the same headers and no body', async () => {
    const response = get(ASSET_LINKS_PATH, 'HEAD');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.text()).toBe('');
  });
});

describe('other paths', () => {
  it('ends every other /.well-known path in a JSON 404', async () => {
    for (const pathname of [
      '/.well-known',
      '/.well-known/',
      '/.well-known/apple-app-site-association',
      '/.well-known/assetlinks',
    ]) {
      const response = get(pathname);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toBe('application/json');
    }
  });

  it('refuses writes', () => {
    const response = get(ASSET_LINKS_PATH, 'POST');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('leaves app routes to the assets binding', () => {
    for (const pathname of ['/', '/properties/abc', '/well-known/assetlinks.json']) {
      expect(request(pathname)).toBeNull();
    }
  });
});

describe('the package matches the app that is built', () => {
  it('names the package of the production app config', () => {
    const saved = process.env.APP_VARIANT;
    delete process.env.APP_VARIANT;
    try {
      jest.resetModules();
      const factory = require(path.join(__dirname, '..', 'app.config.js')) as (config: unknown) => {
        expo: { android: { package: string } };
      };
      expect(ANDROID_PACKAGE).toBe(factory({}).expo.android.package);
    } finally {
      if (saved !== undefined) process.env.APP_VARIANT = saved;
    }
  });
});
