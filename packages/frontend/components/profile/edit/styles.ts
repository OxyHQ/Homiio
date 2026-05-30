import { StyleSheet } from 'react-native';
import { colors } from '@/styles/colors';

/**
 * Shared styles for the profile edit screen and its co-located section
 * components. Extracted verbatim from the original `app/profile/edit.tsx`
 * StyleSheet so the visual output is byte-for-byte identical.
 */
export const profileEditStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_5,
    marginTop: 12,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight_1,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primaryColor,
  },
  tabText: {
    fontSize: 14,
    color: colors.primaryDark,
    fontWeight: '500',
  },
  tabTextActive: {
    color: colors.primaryColor,
    fontWeight: '600',
  },
  container: {
    flex: 1,
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight_1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primaryDark,
    marginBottom: 16,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_5,
    marginBottom: 16,
  },
  subsection: {
    marginBottom: 24,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryDark,
    marginBottom: 12,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryDark,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: colors.primaryLight,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  checkboxGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  checkbox: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    backgroundColor: colors.primaryLight,
  },
  checkboxSelected: {
    backgroundColor: colors.primaryColor,
    borderColor: colors.primaryColor,
  },
  checkboxText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  checkboxTextSelected: {
    color: colors.primaryLight,
  },
  pickerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickerOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    backgroundColor: colors.primaryLight,
  },
  pickerOptionSelected: {
    backgroundColor: colors.primaryColor,
    borderColor: colors.primaryColor,
  },
  pickerOptionText: {
    fontSize: 12,
    color: colors.primaryDark,
  },
  pickerOptionTextSelected: {
    color: colors.primaryLight,
  },
  switchGroup: {
    gap: 12,
  },
  switch: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    backgroundColor: colors.primaryLight,
  },
  switchActive: {
    backgroundColor: colors.primaryColor,
    borderColor: colors.primaryColor,
  },
  switchText: {
    fontSize: 16,
    color: colors.primaryDark,
  },
  switchTextActive: {
    color: colors.primaryLight,
  },
  addButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: colors.primaryColor,
    alignItems: 'center',
    marginTop: 16,
  },
  addButtonText: {
    color: colors.primaryLight,
    fontSize: 14,
    fontWeight: '600',
  },
  referenceCard: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  removeButton: {
    color: colors.primaryColor,
    fontSize: 14,
    fontWeight: '600',
  },
  saveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.primaryLight_1,
    borderRadius: 20,
  },
  saveButtonActive: {
    backgroundColor: colors.primaryColor,
  },
  saveButtonText: {
    color: colors.primaryLight,
    fontSize: 16,
    fontWeight: '600',
  },
  saveSpinnerContainer: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveSpinner: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderColor: colors.primaryLight,
    borderTopColor: 'transparent',
    borderRadius: 8,
  },
  verificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    borderRadius: 8,
    marginBottom: 8,
  },
  verificationItemCompleted: {
    borderColor: colors.online,
    backgroundColor: colors.primaryLight_1,
  },
  verificationItemContent: {
    flex: 1,
  },
  verificationItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  verificationItemDescription: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  verificationStatus: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verificationStatusCompleted: {
    backgroundColor: colors.primaryColor,
    borderColor: colors.primaryColor,
  },
  verificationStatusText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryLight,
  },
  teamMemberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight_1,
  },
  teamMemberInfo: {
    flex: 1,
  },
  teamMemberName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  teamMemberRole: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  teamMemberDate: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  emptyStateText: {
    fontSize: 16,
    color: colors.primaryDark,
    textAlign: 'center',
    marginVertical: 20,
  },
});
