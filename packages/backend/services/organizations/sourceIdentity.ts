/** Stable advertiser identity within its source. Shared by ingestion and migration. */
export function agencySourceKey(source: string, agencySourceId: string): string {
  if (!source.trim() || !agencySourceId.trim()) throw new Error('Stable source identity required');
  return `provider:${source}:${agencySourceId.trim()}`;
}
