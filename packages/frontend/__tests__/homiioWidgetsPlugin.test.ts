/**
 * The widget config plugin's origin validation.
 *
 * Worth a test because of WHERE a bad value surfaces. The plugin writes a string resource
 * that Kotlin later concatenates with a path and hands to `URL(...)` and to
 * `Intent.ACTION_VIEW`; nothing between here and a user's home screen looks at it again.
 * So a malformed origin does not fail a build, it ships — as a widget that never loads and
 * a tap that opens nothing.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { assertBaseUrl } = require('../modules/homiio-widgets/app.plugin');

describe('withHomiioWidgets origin validation', () => {
  it('accepts the origins the module actually ships with', () => {
    expect(() => assertBaseUrl('apiBaseUrl', 'https://api.homiio.com')).not.toThrow();
    expect(() => assertBaseUrl('webBaseUrl', 'https://homiio.com')).not.toThrow();
  });

  it('tolerates the trailing slash the Kotlin side trims', () => {
    expect(() => assertBaseUrl('apiBaseUrl', 'https://api.homiio.com/')).not.toThrow();
  });

  it('accepts a plain-http development origin with a port', () => {
    expect(() => assertBaseUrl('apiBaseUrl', 'http://192.168.1.10:4000')).not.toThrow();
  });

  it('rejects anything that is not an absolute URL', () => {
    expect(() => assertBaseUrl('apiBaseUrl', '/api')).toThrow(/absolute URL/);
    expect(() => assertBaseUrl('apiBaseUrl', 'api.homiio.com')).toThrow(/absolute URL/);
  });

  it('rejects an empty or padded value', () => {
    expect(() => assertBaseUrl('apiBaseUrl', '')).toThrow(/non-empty/);
    expect(() => assertBaseUrl('apiBaseUrl', ' https://api.homiio.com ')).toThrow(/non-empty/);
    expect(() => assertBaseUrl('apiBaseUrl', undefined)).toThrow(/non-empty/);
  });

  it('rejects a scheme the widget cannot fetch over', () => {
    expect(() => assertBaseUrl('apiBaseUrl', 'ftp://api.homiio.com')).toThrow(/http or https/);
    expect(() => assertBaseUrl('webBaseUrl', 'homiio://open')).toThrow(/http or https/);
  });

  /**
   * A path here would be silently doubled: the Kotlin builds `$base/api/properties/search`
   * itself, so `https://api.homiio.com/api` becomes `/api/api/properties/search`.
   */
  it('rejects an origin carrying a path, query or fragment', () => {
    expect(() => assertBaseUrl('apiBaseUrl', 'https://api.homiio.com/api')).toThrow(/bare origin/);
    expect(() => assertBaseUrl('apiBaseUrl', 'https://api.homiio.com?x=1')).toThrow(/bare origin/);
    expect(() => assertBaseUrl('webBaseUrl', 'https://homiio.com#top')).toThrow(/bare origin/);
  });

  it('names the option it rejected, so a failed build says which one', () => {
    expect(() => assertBaseUrl('webBaseUrl', 'nonsense')).toThrow(/webBaseUrl/);
  });
});
