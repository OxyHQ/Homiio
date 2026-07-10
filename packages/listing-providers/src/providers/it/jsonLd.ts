/**
 * schema.org JSON-LD extraction for Italian portals (Idealista.it, Casa.it, …).
 *
 * Implementation lives in {@link ../../parse/jsonLd} — this module is the
 * stable IT-market export path.
 */
export {
  extractItSchemaListings,
  pickItListing,
  type ItSchemaListing,
} from '../../parse/jsonLd';
