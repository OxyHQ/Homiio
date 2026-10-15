import cors from 'cors';

/** Anonymous card resolution from Mention's browser. Mounted before parsers and
 * rate limiting so errors carry the same CORS policy as successful batches. */
export const publicCaseCors = cors({
  origin: ['https://mention.earth', 'https://www.mention.earth'],
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
  maxAge: 86400,
});
