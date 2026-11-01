import * as legacy from '@homiio/shared-types/watch';
import * as core from '@homiio/shared-types/watch-core';

test('the granular watch entry preserves every legacy core export', () => {
  for (const key of Object.keys(core) as (keyof typeof core)[]) {
    expect(legacy[key]).toBe(core[key]);
  }
  expect(legacy.findUnsafeAlertFields({ location: { latitude: 1 } })).toEqual([
    "location.latitude: field name contains 'latitude'",
  ]);
});
