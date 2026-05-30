import { StyleSheet } from 'react-native';
import { colors } from '@/styles/colors';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  settingLabel: {
    fontSize: 16,
  },
  adFreeBanner: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 8,
    marginTop: 24,
    marginBottom: 24,
  },
  adFreeBannerText: {
    textAlign: 'center',
    color: colors.muted,
    fontSize: 14,
  },
});
