/**
 * schema.org JSON-LD extraction for the Spanish portals (Idealista, Fotocasa).
 *
 * Implementation lives in {@link ../../parse/jsonLd} — this module is the
 * stable ES-market export path.
 */
export {
  extractEsSchemaListings,
  pickEsListing,
  type EsSchemaListing,
} from '../../parse/jsonLd';
