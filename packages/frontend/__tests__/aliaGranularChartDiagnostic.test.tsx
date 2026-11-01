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

import { render } from '@testing-library/react-native';
import { BloomThemeProvider } from '@oxy.so/bloom/theme';

it.each([['legacy', legacy.BarListCard], ['granular', BarListCard]] as const)(
  'renders the same bar list via %s',
  (_entry, Component) => {
    const screen = render(
      <BloomThemeProvider colorPreset="blue" fonts={false}>
        <Component title="Housing" items={[{ label: 'Madrid', value: 12 }]} />
      </BloomThemeProvider>,
    );
    expect(screen.getByText('Housing')).toBeTruthy();
    expect(screen.getByText('Madrid')).toBeTruthy();
    screen.unmount();
  },
);

it.each([['legacy', legacy.LineChartCard], ['granular', LineChartCard]] as const)(
  'renders the same line chart via %s',
  (_entry, Component) => {
    const screen = render(
      <BloomThemeProvider colorPreset="blue" fonts={false}>
        <Component title="Demand" data={[{ label: 'Monday', value: 3 }, { label: 'Tuesday', value: 5 }]} />
      </BloomThemeProvider>,
    );
    expect(screen.getByText('Demand')).toBeTruthy();
    screen.unmount();
  },
);
