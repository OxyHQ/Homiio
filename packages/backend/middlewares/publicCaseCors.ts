import { createOxyCors } from '@oxy.so/core/server';

/** Anonymous card resolution from Mention's browser. Mounted before parsers and
 * rate limiting so errors carry the same CORS policy as successful batches.
 * No credentials: the cards are public and the request carries none. */
export const publicCaseCors = createOxyCors({
  appOrigins: ['https://mention.earth', 'https://www.mention.earth'],
  allowCredentials: false,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
});
