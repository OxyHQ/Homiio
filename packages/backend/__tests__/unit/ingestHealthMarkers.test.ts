/**
 * The log markers are a cross-repo contract, so this file is a GATE, not a
 * characterisation test.
 *
 * Each literal below is matched verbatim by an `aws_cloudwatch_log_metric_filter`
 * in `oxy-infra/terraform-uswest2/alerts.tf`. Nothing in either repo's build
 * connects the two: rename a marker and the filter keeps matching a string
 * nobody emits any more, the metric flatlines at its `default_value` of 0, the
 * alarm never fires, and the first sign of trouble is a user asking why the app
 * has no homes — which is precisely the incident this whole change exists to
 * stop repeating.
 *
 * So a rename has to fail HERE, loudly, with the other repo named in the
 * failure. If you are reading this because the test went red: change
 * `alerts.tf` in oxy-infra in the same PR, then update the literal below.
 */

import {
  countsAsLiveIngest,
  LISTING_INGEST_OK_MARKER,
  LISTING_PROXY_UNUSABLE_MARKER,
  NON_LIVE_INGEST_PROVIDERS,
} from '../../services/ingestion/ingestHealthMarkers';

describe('CloudWatch log markers', () => {
  it('pins the exact strings alerts.tf matches on', () => {
    // Changing either literal REQUIRES the matching edit to
    // oxy-infra/terraform-uswest2/alerts.tf — see this file's header.
    expect(LISTING_INGEST_OK_MARKER).toBe('listing-ingest-ok');
    expect(LISTING_PROXY_UNUSABLE_MARKER).toBe('listing-proxy-unusable');
  });

  it('keeps markers free of characters a metric-filter pattern would eat', () => {
    // CloudWatch filter patterns quote a bare term; whitespace would split it
    // into two terms and a quote would end the pattern early. Both failures are
    // silent at apply time.
    for (const marker of [LISTING_INGEST_OK_MARKER, LISTING_PROXY_UNUSABLE_MARKER]) {
      expect(marker).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe('countsAsLiveIngest', () => {
  it('excludes fixtures, which stayed green through the whole outage', () => {
    // During 2026-09-20's two-month outage the seeded fixtures kept ingesting
    // 8/day. An alarm that counted them would have been green throughout.
    expect(countsAsLiveIngest('fixture')).toBe(false);
    expect(NON_LIVE_INGEST_PROVIDERS.has('fixture')).toBe(true);
  });

  it('counts every real portal', () => {
    for (const provider of ['fotocasa', 'habitaclia', 'pisos', 'rightmove', 'otodom', 'immoweb']) {
      expect(countsAsLiveIngest(provider)).toBe(true);
    }
  });
});
