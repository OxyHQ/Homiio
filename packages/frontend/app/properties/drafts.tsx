import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { Header } from '@/components/Header';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EmptyState } from '@/components/ui/EmptyState';

const IconComponent = Ionicons as any;

interface PropertyDraft {
  id: string;
  title: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  type: string;
  description: string;
  rent: {
    amount: number;
    currency: string;
  };
  images: any[];
  lastSaved: Date;
  formData: any;
}

export default function PropertyDraftsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [drafts, setDrafts] = useState<PropertyDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingDraft, setDeletingDraft] = useState<string | null>(null);

  useEffect(() => {
    loadDrafts();
  }, []);

  const loadDrafts = async () => {
    try {
      setLoading(true);
      const draftsData = await AsyncStorage.getItem('property_drafts');
      if (draftsData) {
        const parsedDrafts = JSON.parse(draftsData);
        // Convert string dates back to Date objects
        const draftsWithDates = parsedDrafts.map((draft: any) => ({
          ...draft,
          lastSaved: new Date(draft.lastSaved),
        }));
        setDrafts(draftsWithDates);
      }
    } catch (error) {
      console.error('Error loading drafts:', error);
      toast.error('Failed to load drafts');
    } finally {
      setLoading(false);
    }
  };

  const deleteDraft = async (draftId: string) => {
    Alert.alert(
      'Delete Draft',
      'Are you sure you want to delete this draft? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingDraft(draftId);
              const updatedDrafts = drafts.filter((draft) => draft.id !== draftId);
              await AsyncStorage.setItem('property_drafts', JSON.stringify(updatedDrafts));
              setDrafts(updatedDrafts);
              toast.success('Draft deleted successfully');
            } catch (error) {
              console.error('Error deleting draft:', error);
              toast.error('Failed to delete draft');
            } finally {
              setDeletingDraft(null);
            }
          },
        },
      ],
    );
  };

  const continueEditing = (draft: PropertyDraft) => {
    // Store the draft data in AsyncStorage for the create screen to load
    AsyncStorage.setItem('current_draft', JSON.stringify(draft.formData))
      .then(() => {
        router.push('/properties/create');
      })
      .catch((error) => {
        console.error('Error setting current draft:', error);
        toast.error('Failed to load draft');
      });
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 1) {
      return 'Just now';
    } else if (diffInHours < 24) {
      return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    } else {
      const diffInDays = Math.floor(diffInHours / 24);
      return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
    }
  };

  const getPropertyTypeIcon = (type: string) => {
    const iconMap: { [key: string]: string } = {
      apartment: 'business-outline',
      house: 'home-outline',
      room: 'bed-outline',
      studio: 'home-outline',
      couchsurfing: 'people-outline',
      roommates: 'people-circle-outline',
      coliving: 'home-outline',
      hostel: 'bed-outline',
      guesthouse: 'home-outline',
      campsite: 'leaf-outline',
      boat: 'boat-outline',
      treehouse: 'leaf-outline',
      yurt: 'home-outline',
      other: 'ellipsis-horizontal-outline',
    };
    return iconMap[type] || 'home-outline';
  };

  const getPropertyTypeLabel = (type: string) => {
    const labelMap: { [key: string]: string } = {
      apartment: 'Apartment',
      house: 'House',
      room: 'Room',
      studio: 'Studio',
      couchsurfing: 'Couchsurfing',
      roommates: 'Roommates',
      coliving: 'Co-Living',
      hostel: 'Hostel',
      guesthouse: 'Guesthouse',
      campsite: 'Campsite',
      boat: 'Boat/Houseboat',
      treehouse: 'Treehouse',
      yurt: 'Yurt/Tent',
      other: 'Other',
    };
    return labelMap[type] || 'Property';
  };

  const renderDraftCard = (draft: PropertyDraft) => (
    <View key={draft.id} style={styles.draftCard}>
      <View style={styles.draftHeader}>
        <View style={styles.draftTypeContainer}>
          <IconComponent
            name={getPropertyTypeIcon(draft.type)}
            size={20}
            color={colors.primaryColor}
          />
          <ThemedText style={styles.draftType}>{getPropertyTypeLabel(draft.type)}</ThemedText>
        </View>
        <View style={styles.draftActions}>
          <TouchableOpacity style={styles.actionButton} onPress={() => continueEditing(draft)}>
            <IconComponent name="create-outline" size={20} color={colors.primaryColor} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => deleteDraft(draft.id)}
            disabled={deletingDraft === draft.id}
          >
            {deletingDraft === draft.id ? (
              <ActivityIndicator size="small" color={colors.primaryColor} />
            ) : (
              <IconComponent name="trash-outline" size={20} color="#ff6b6b" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.draftContent}>
        <ThemedText style={styles.draftTitle}>
          {draft.title || `${draft.address.street}, ${draft.address.city}`}
        </ThemedText>

        <ThemedText style={styles.draftAddress}>
          {draft.address.street}, {draft.address.city}, {draft.address.state}{' '}
          {draft.address.zipCode}
        </ThemedText>

        {draft.rent.amount > 0 && (
          <ThemedText style={styles.draftPrice}>
            ${draft.rent.amount.toLocaleString()}/
            {draft.rent.currency === 'USD' ? 'month' : draft.rent.currency}
          </ThemedText>
        )}

        <View style={styles.draftMeta}>
          <View style={styles.draftMetaItem}>
            <IconComponent name="time-outline" size={14} color={colors.primaryDark_1} />
            <ThemedText style={styles.draftMetaText}>{formatDate(draft.lastSaved)}</ThemedText>
          </View>
          <View style={styles.draftMetaItem}>
            <IconComponent name="save-outline" size={14} color={colors.primaryDark_1} />
            <ThemedText style={styles.draftMetaText}>Draft</ThemedText>
          </View>
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Header
          options={{
            showBackButton: true,
            title: 'Property Drafts',
            titlePosition: 'center',
          }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primaryColor} />
          <ThemedText style={styles.loadingText}>Loading drafts...</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header
        options={{
          showBackButton: true,
          title: 'Property Drafts',
          titlePosition: 'center',
        }}
      />

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {drafts.length === 0 ? (
            <EmptyState
              icon="folder-open-outline"
              title="No Drafts Found"
              description="You don't have any saved property drafts yet. Start creating a property to save drafts automatically."
              actionText="Create New Property"
              actionIcon="add"
              onAction={() => router.push('/properties/create')}
            />
          ) : (
            <>
              <View style={styles.header}>
                <ThemedText style={styles.headerTitle}>Saved Drafts ({drafts.length})</ThemedText>
                <ThemedText style={styles.headerSubtitle}>
                  Continue editing your property drafts or start a new one
                </ThemedText>
              </View>

              <View style={styles.draftsList}>{drafts.map(renderDraftCard)}</View>

              <TouchableOpacity
                style={styles.createNewButton}
                onPress={() => router.push('/properties/create')}
              >
                <IconComponent name="add-circle" size={24} color={colors.primaryColor} />
                <ThemedText style={styles.createNewButtonText}>Create New Property</ThemedText>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  content: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: colors.primaryDark_1,
  },

  header: {
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: colors.primaryDark_1,
  },
  draftsList: {
    gap: 16,
  },
  draftCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  draftHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  draftTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  draftType: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  draftActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
  },
  deleteButton: {
    backgroundColor: colors.primaryLight,
  },
  draftContent: {
    gap: 8,
  },
  draftTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
  },
  draftAddress: {
    fontSize: 14,
    color: colors.primaryDark_1,
  },
  draftPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryColor,
  },
  draftMeta: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  draftMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  draftMetaText: {
    fontSize: 12,
    color: colors.primaryDark_1,
  },
  createNewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.primaryColor,
    borderStyle: 'dashed',
    marginTop: 24,
    gap: 8,
  },
  createNewButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryColor,
  },
});
