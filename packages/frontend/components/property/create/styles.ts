import { StyleSheet } from 'react-native';
import { colors } from '@/styles/colors';

/**
 * Shared styles for the property creation wizard.
 *
 * Moved verbatim from `app/properties/create.tsx` so the orchestrator and the
 * per-step components reference the exact same visual definitions. No values
 * were changed during extraction.
 */
export const createPropertyStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  formGroup: {
    marginBottom: 16,
  },
  numberSelectorContainer: {
    marginTop: 8,
  },
  formRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  formGroupLeft: {
    flex: 1,
    marginRight: 8,
  },
  formGroupRight: {
    flex: 1,
    marginLeft: 8,
  },
  inputCentered: {
    justifyContent: 'center',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  label: {
    fontSize: 14,
    marginBottom: 8,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  input: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: colors.primaryDark,
  },
  inputError: {
    borderColor: 'red',
  },
  textArea: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: colors.primaryDark,
    minHeight: 120,
  },
  errorText: {
    color: 'red',
    fontSize: 12,
    marginTop: 4,
  },
  addressInstructions: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginBottom: 16,
    lineHeight: 20,
  },
  pickerValueSelected: {
    color: colors.primaryDark,
  },
  pickerValuePlaceholder: {
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  propertyTypeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  propertyTypeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    marginBottom: 8,
  },
  propertyTypeButtonSelected: {
    backgroundColor: colors.primaryColor,
    borderColor: colors.primaryColor,
  },
  propertyTypeText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  propertyTypeTextSelected: {
    color: 'white',
    fontWeight: 'bold',
  },
  mapContainer: {
    marginBottom: 16,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
  },
  mapWrapper: {
    position: 'relative',
  },
  fullscreenButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  fullscreenMapContainer: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  fullscreenMapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenMapTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  confirmButton: {
    backgroundColor: colors.primaryColor,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  confirmButtonText: {
    color: colors.primaryLight,
    fontSize: 14,
    fontWeight: '600',
  },
  amenitiesSelector: {
    marginTop: 8,
  },
  rulesSectionTitle: {
    marginTop: 24,
    marginBottom: 16,
  },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
  },
  toggleButtonActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primaryColor,
  },
  toggleText: {
    marginLeft: 8,
    fontSize: 14,
  },
  toggleButtonText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  toggleButtonTextActive: {
    color: colors.primaryColor,
    fontWeight: 'bold',
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addressDetailWrapper: {
    flex: 1,
  },
  addressDetailContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
  },
  messageContainer: {
    marginTop: 4,
  },
  detailInput: {
    flex: 1,
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: colors.primaryDark,
    height: 48,
  },
  privacyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    gap: 6,
  },
  privacyToggleActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primaryColor,
  },
  privacyToggleText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  privacyToggleTextActive: {
    color: colors.primaryColor,
    fontWeight: '600',
  },
  inputWrapper: {
    flex: 1,
  },
  fieldError: {
    color: '#FF3B30',
    fontSize: 12,
    marginTop: 4,
    marginLeft: 4,
  },
  privacyMessage: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginTop: 4,
    marginLeft: 4,
  },
  mediaUploadContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    marginVertical: 16,
  },
  uploadButton: {
    backgroundColor: colors.primaryColor,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  uploadText: {
    color: colors.primaryLight,
    fontSize: 16,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
    marginBottom: 16,
  },
  imagePreviewContainer: {
    minHeight: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noImagesText: {
    color: colors.COLOR_BLACK_LIGHT_4,
    fontStyle: 'italic',
  },
  submitContainer: {
    alignItems: 'center',
    marginTop: 16,
  },
  sharedSpacesLabel: {
    marginTop: 16,
  },
  navigationContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  // Ethical Pricing Styles
  ethicalPricingContainer: {
    marginTop: 12,
  },
  ethicalPricingCard: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    padding: 12,
  },
  ethicalPricingWarning: {
    borderColor: '#FFA500',
    backgroundColor: '#FFF8E1',
  },
  ethicalPricingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  ethicalPricingTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
    color: colors.COLOR_BLACK_LIGHT_1,
  },
  ethicalPricingText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_2,
    marginBottom: 4,
  },
  ethicalPricingWarningText: {
    fontSize: 12,
    color: '#FF6B35',
    marginTop: 8,
  },
  ethicalPricingWarnings: {
    marginTop: 8,
  },
  formContainer: {
    // This style is used to contain the form content and debug info
    // It's not directly applied to the form content or debug info,
    // but it helps in organizing the layout.
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorButton: {
    backgroundColor: colors.primaryColor,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  errorButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
