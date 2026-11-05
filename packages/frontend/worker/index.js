import { handleWellKnown } from './appAssociation.js';

export default {
  fetch(request, env) {
    // `/.well-known/` is answered here (App Links); everything else is the app.
    return handleWellKnown(request) ?? env.ASSETS.fetch(request);
  },
};
