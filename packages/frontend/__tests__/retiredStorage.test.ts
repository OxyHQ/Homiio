/**
 * A retired feature leaves nothing on the device: its keys are removed at
 * startup, and only its keys.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearRetiredStorage, RETIRED_STORAGE_KEYS } from '@/utils/retiredStorage';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('clearRetiredStorage', () => {
  it("removes Settings → Sindi's old preferences and keeps everything else", async () => {
    await AsyncStorage.setItem('@homiio/sindi-preferences', '{"state":{"showTips":false}}');
    await AsyncStorage.setItem('@homiio/ui', '{"state":{}}');

    await clearRetiredStorage();

    expect(await AsyncStorage.getItem('@homiio/sindi-preferences')).toBeNull();
    expect(await AsyncStorage.getItem('@homiio/ui')).toBe('{"state":{}}');
  });

  it('does nothing on a device that never had them', async () => {
    await expect(clearRetiredStorage()).resolves.toBeUndefined();
    expect(RETIRED_STORAGE_KEYS).toContain('@homiio/sindi-preferences');
  });
});
