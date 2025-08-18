import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemedText } from './ThemedText';
import { colors } from '@/styles/colors';
import { Property } from '@homiio/shared-types';
import { PropertyCard } from './PropertyCard';
import Button from './Button';

const IconComponent = Ionicons as any;

interface EditNotesBottomSheetProps {
  propertyId: string;
  propertyTitle: string;
  property?: Property;
  currentNotes: string;
  onClose: () => void;
  onSave: (notes: string) => void;
}

export function EditNotesBottomSheet({
  propertyId,
  propertyTitle,
  property,
  currentNotes,
  onClose,
  onSave,
}: EditNotesBottomSheetProps) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState(currentNotes);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (isSaving) return;

    try {
      setIsSaving(true);
      await onSave(notes);
      onClose();
    } catch (error) {
      console.error('Failed to save notes:', error);
      Alert.alert('Error', 'Failed to save notes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [notes, onSave, onClose, isSaving]);

  const handleCancel = () => {
    if (notes !== currentNotes) {
      Alert.alert(
        'Discard Changes',
        'You have unsaved changes. Are you sure you want to discard them?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: onClose },
        ],
      );
    } else {
      onClose();
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <ThemedText style={styles.title}>Edit Notes</ThemedText>
        <TouchableOpacity onPress={handleCancel} style={styles.closeButton}>
          <IconComponent name="close" size={24} color={colors.COLOR_BLACK_LIGHT_4} />
        </TouchableOpacity>
      </View>

      {/* Property Card */}
      {property ? (
        <View style={styles.propertyCardContainer}>
          <PropertyCard
            property={property}
            variant="compact"
            orientation="horizontal"
            showFavoriteButton={false}
            showVerifiedBadge={false}
            showTypeIcon={false}
            showFeatures={false}
            showRating={false}
          />
        </View>
      ) : (
        <ThemedText style={styles.propertyTitle} numberOfLines={2}>
          {propertyTitle}
        </ThemedText>
      )}

      {/* Notes Input */}
      <View style={styles.notesSection}>
        <ThemedText style={styles.notesLabel}>My Notes</ThemedText>
        <TextInput
          style={styles.notesInput}
          placeholder="Add your notes about this property..."
          value={notes}
          onChangeText={setNotes}
          multiline
          textAlignVertical="top"
          maxLength={1000}
          autoFocus
        />
        <ThemedText style={styles.characterCount}>{notes.length}/1000 characters</ThemedText>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity onPress={handleCancel} style={styles.cancelButton} disabled={isSaving}>
          <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
        </TouchableOpacity>
        <Button onPress={handleSave} disabled={isSaving} style={styles.saveButton}>
          {isSaving ? 'Saving...' : 'Save Notes'}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  propertyTitle: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_2,
    marginBottom: 20,
  },
  propertyCardContainer: {
    marginBottom: 20,
  },
  notesSection: {
    marginBottom: 20,
  },
  notesLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: colors.COLOR_BLACK_LIGHT_1,
  },
  notesInput: {
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
    minHeight: 120,
    textAlignVertical: 'top',
    color: colors.COLOR_BLACK_LIGHT_1,
  },
  characterCount: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    textAlign: 'right',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  cancelButtonText: {
    color: colors.COLOR_BLACK_LIGHT_2,
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
  },
});
