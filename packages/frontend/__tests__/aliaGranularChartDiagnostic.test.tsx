/** Diagnostic parity checks against the temporary CI package fixture. */
import * as legacy from '@oxy.so/bloom/chart-cards';
import { BarListCard } from '@oxy.so/bloom/chart-cards/bar-list';
import { LineChartCard } from '@oxy.so/bloom/chart-cards/line';
import { ChartCardSurface } from '@oxy.so/bloom/chart-cards/surface';
import { ChartHeadline } from '@oxy.so/bloom/chart-cards/header';
import { ChartStatTiles } from '@oxy.so/bloom/chart-cards/stat-tiles';
import { useAskAgent as rootUseAskAgent } from '@alia.onl/sdk';
import { useAskAgent as askUseAskAgent } from '@alia.onl/sdk/ask';

it('uses the same React component objects through both Bloom entry paths', () => {
  expect(BarListCard).toBe(legacy.BarListCard);
  expect(LineChartCard).toBe(legacy.LineChartCard);
  expect(ChartCardSurface).toBe(legacy.ChartCardSurface);
  expect(ChartHeadline).toBe(legacy.ChartHeadline);
  expect(ChartStatTiles).toBe(legacy.ChartStatTiles);
});

it('keeps the shared Alia ask hook across root and ask entries', () => {
  expect(rootUseAskAgent).toBe(askUseAskAgent);
});
