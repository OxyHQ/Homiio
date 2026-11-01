/** Component identity under the isolated native Jest fixture, not a device test. */
import * as legacy from '@oxy.so/bloom/chart-cards';
import { BarListCard } from '@oxy.so/bloom/chart-cards/bar-list';
import { LineChartCard } from '@oxy.so/bloom/chart-cards/line';
import { ChartCardSurface } from '@oxy.so/bloom/chart-cards/surface';
import { ChartHeadline } from '@oxy.so/bloom/chart-cards/header';
import { ChartStatTiles } from '@oxy.so/bloom/chart-cards/stat-tiles';

it('uses the identical React components through both Bloom entry paths', () => {
  expect(BarListCard).toBe(legacy.BarListCard);
  expect(LineChartCard).toBe(legacy.LineChartCard);
  expect(ChartCardSurface).toBe(legacy.ChartCardSurface);
  expect(ChartHeadline).toBe(legacy.ChartHeadline);
  expect(ChartStatTiles).toBe(legacy.ChartStatTiles);
});
