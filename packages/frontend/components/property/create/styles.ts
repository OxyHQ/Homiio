import { Platform, StyleSheet } from 'react-native';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

/**
 * Layout-only styles shared by the property creation wizard. Controls, labels,
 * hints and errors are Bloom (`Field`, `TextFieldInput`, `stay-filters` choices,
 * `CheckboxCard`, `RadioGroup`…), so nothing here paints a control.
 */
export const createPropertyStyles = StyleSheet.create({
  /**
   * At least a viewport tall on web, where the document scrolls: the scroll view
   * grows into it, so a short step still has the wizard footer at the bottom.
   */
  container: {
    flex: 1,
    ...(Platform.OS === 'web' ? { minHeight: '100dvh' as unknown as number } : null),
  },
  scrollView: {
    flexGrow: 1,
  },
  /** The step column: Bloom's housing publish template's 680 column, the progress 32 above the step. */
  scrollContent: {
    width: '100%',
    maxWidth: 680 + spacing.lg * 2,
    alignSelf: 'center',
    padding: spacing.lg,
    paddingBottom: spacing['2xl'],
    gap: 32,
  },
  /** Vertical rhythm of one step: title, then every field group. */
  step: {
    gap: spacing.xl,
  },
  formRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  formRowItem: {
    flex: 1,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  /** A column of `SwitchFilterRow`s. */
  switches: {
    gap: spacing.lg,
  },
  /** A column of selection cards. */
  cards: {
    gap: spacing.md,
  },
  instructions: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 20,
  },
  mapContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
  },
  mapWrapper: {
    position: 'relative',
  },
  mapOverlayButton: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  fullscreenMapContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fullscreenMapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  fullscreenMapTitle: {
    flex: 1,
    textAlign: 'center',
  },
  centeredState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    padding: 20,
  },
});
