import { StyleSheet } from 'react-native';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

/**
 * Layout-only styles shared by the property creation wizard. Controls, labels,
 * hints and errors are Bloom (`Field`, `TextFieldInput`, `Chip`, `Switch`,
 * `CheckboxCard`, `RadioCard`…), so nothing here paints a control.
 */
export const createPropertyStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 100,
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
  errorText: {
    color: colors.danger,
    fontSize: 12,
  },
  submitContainer: {
    alignItems: 'center',
    gap: spacing.md,
  },
  helperText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
  },
  navigationContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
  },
  navigationSpacer: {
    flex: 1,
  },
  centeredState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    padding: 20,
  },
});
