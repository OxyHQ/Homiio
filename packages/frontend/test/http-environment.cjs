const { TestEnvironment } = require('jest-environment-node');
// Capture Node's actual network implementation before jest-expo installs its
// native-module mocks. Tests opt in explicitly; app transport is not mocked.
const realHttp = { fetch, Headers, Request, Response, FormData, Blob, AbortController };
module.exports = class HttpEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();
    this.global.__realHttp = realHttp;
  }
};
