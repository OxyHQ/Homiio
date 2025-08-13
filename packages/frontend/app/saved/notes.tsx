import React, { useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, FlatList, TextInput, TouchableOpacity, Text, Alert, Image, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Header } from '@/components/Header';
import Button from '@/components/Button';
import { colors } from '@/styles/colors';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { parseNotesString, serializeNotesArray, upsertNote, deleteNote, toggleArchive, togglePin, PropertyNote } from '@/utils/notes';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';

import savedPropertyService from '@/services/savedPropertyService';
import { useOxy } from '@oxyhq/services';

export default function NotesScreen() {
    const { t } = useTranslation();
    const { oxyServices, activeSessionId } = useOxy();
    const { savedProperties } = useSavedPropertiesContext();

    // Flatten notes into a masonry-like grid with property preview
    const flatNotes = useMemo(() => {
        const out: Array<{ propertyId: string; note: PropertyNote; title: string; image: any; price?: number; currency?: string; location?: string; bedrooms?: number; bathrooms?: number; }> = [];
        savedProperties.forEach((p) => {
            const pid = (p._id || p.id) as string;
            const notesArr = parseNotesString(p.notes as any);
            const title = getPropertyTitle(p) || p.address?.city || 'Property';
            const image = getPropertyImageSource(p);
            const price = p.rent?.amount;
            const currency = p.rent?.currency;
            const location = [p.address?.city, p.address?.state].filter(Boolean).join(', ');
            const bedrooms = p.bedrooms;
            const bathrooms = p.bathrooms;
            notesArr.forEach((n) => out.push({ propertyId: pid, note: n, title, image, price, currency, location, bedrooms, bathrooms }));
        });
        return out;
    }, [savedProperties]);

    const [editing, setEditing] = useState<{ propertyId: string | null; note?: PropertyNote } | null>(null);
    const [text, setText] = useState('');
    const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'active' | 'pinned' | 'archived'>('all');

    const handleSaveNote = useCallback(async () => {
        if (!editing) return;
        const { propertyId, note } = editing;
        const targetPropId = propertyId || selectedPropertyId || ((savedProperties[0]?._id || savedProperties[0]?.id) as string | undefined);
        if (!targetPropId) return;
        try {
            const prop = savedProperties.find((p) => (p._id || p.id) === targetPropId);
            if (!prop) return;
            const currentNotes = parseNotesString(prop.notes as any);
            const updatedNotes = upsertNote(currentNotes, { id: note?.id, text });
            const payload = serializeNotesArray(updatedNotes);
            if (!oxyServices || !activeSessionId) return;
            await savedPropertyService.updateNotes(targetPropId, payload, oxyServices, activeSessionId);
            setEditing(null);
            setText('');
            Alert.alert(t('common.success'), t('common.update'));
        } catch {
            Alert.alert(t('common.error'), t('saved.errors.updateNotesFailed'));
        }
    }, [editing, text, oxyServices, activeSessionId, savedProperties, selectedPropertyId, t]);

    const handleDeleteNote = useCallback(async (propertyId: string, noteId: string) => {
        try {
            const prop = savedProperties.find((p) => (p._id || p.id) === propertyId);
            if (!prop) return;
            const updatedNotes = deleteNote(parseNotesString(prop.notes as any), noteId);
            const payload = serializeNotesArray(updatedNotes);
            if (!oxyServices || !activeSessionId) return;
            await savedPropertyService.updateNotes(propertyId, payload, oxyServices, activeSessionId);
            Alert.alert(t('common.success'), t('common.update'));
        } catch {
            Alert.alert(t('common.error'), t('saved.errors.updateNotesFailed'));
        }
    }, [savedProperties, oxyServices, activeSessionId, t]);

    const persistNotes = useCallback(async (propertyId: string, mutator: (arr: PropertyNote[]) => PropertyNote[]) => {
        const prop = savedProperties.find((p) => (p._id || p.id) === propertyId);
        if (!prop || !oxyServices || !activeSessionId) return;
        const updated = mutator(parseNotesString(prop.notes as any));
        await savedPropertyService.updateNotes(propertyId, serializeNotesArray(updated), oxyServices, activeSessionId);
    }, [savedProperties, oxyServices, activeSessionId]);

    const handleToggleArchive = useCallback(async (propertyId: string, noteId: string) => {
        try {
            await persistNotes(propertyId, (arr) => toggleArchive(arr, noteId));
        } catch {
            Alert.alert(t('common.error'), t('saved.errors.updateNotesFailed'));
        }
    }, [persistNotes, t]);

    const handleTogglePin = useCallback(async (propertyId: string, noteId: string) => {
        try {
            await persistNotes(propertyId, (arr) => togglePin(arr, noteId));
        } catch {
            Alert.alert(t('common.error'), t('saved.errors.updateNotesFailed'));
        }
    }, [persistNotes, t]);

    return (
        <View style={styles.container}>
            <Header options={{ title: t('saved.notes.title', 'Notes'), showBackButton: true }} />
            <View style={styles.tabsContainer}>
                {[
                    { key: 'all', label: 'All' },
                    { key: 'active', label: 'Active' },
                    { key: 'pinned', label: 'Pinned' },
                    { key: 'archived', label: 'Archived' },
                ].map((tab) => (
                    <TouchableOpacity
                        key={tab.key}
                        style={[styles.tabItem, filter === tab.key && styles.tabItemActive]}
                        onPress={() => setFilter(tab.key as any)}
                    >
                        <Text style={[styles.tabText, filter === tab.key && styles.tabTextActive]}>{tab.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            <FlatList
                data={flatNotes
                    .filter((n) => {
                        if (filter === 'archived') return !!n.note.isArchived;
                        if (filter === 'pinned') return !!n.note.isPinned && !n.note.isArchived;
                        if (filter === 'active') return !n.note.isArchived;
                        return true;
                    })
                    .sort((a, b) => {
                        const pinDiff = Number(!!b.note.isPinned) - Number(!!a.note.isPinned);
                        if (pinDiff !== 0) return pinDiff;
                        const ad = Date.parse(a.note.updatedAt || a.note.createdAt);
                        const bd = Date.parse(b.note.updatedAt || b.note.createdAt);
                        return bd - ad;
                    })}
                keyExtractor={(item) => `${item.propertyId}-${item.note.id}`}
                numColumns={2}
                columnWrapperStyle={styles.gridRow}
                contentContainerStyle={styles.content}
                renderItem={({ item }) => (
                    <TouchableOpacity style={[styles.noteCard, item.note.isArchived && styles.archivedCard, item.note.color ? { backgroundColor: item.note.color, borderColor: 'transparent' } : null]} onPress={() => { setEditing({ propertyId: item.propertyId, note: item.note }); setText(item.note.text); }}>
                        <Text style={styles.noteText} numberOfLines={6}>{item.note.text}</Text>
                        <TouchableOpacity style={styles.previewCard} onPress={() => router.push(`/properties/${item.propertyId}`)}>
                            <Image source={item.image} style={styles.previewImageL} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.previewTitle} numberOfLines={2}>{item.title}</Text>
                                <Text style={[styles.previewMeta, { flex: 1 }]} numberOfLines={1}>
                                    {item.price ? `${item.price}${item.currency ? ' ' + item.currency : ''}` : ''}
                                    {(item.price && (item.bedrooms || item.bathrooms || item.location)) ? ' • ' : ''}
                                    {item.bedrooms ? `${item.bedrooms} bd` : ''}
                                    {(item.bedrooms && item.bathrooms) ? ' • ' : ''}
                                    {item.bathrooms ? `${item.bathrooms} ba` : ''}
                                    {((item.bedrooms || item.bathrooms) && item.location) ? ' • ' : ''}
                                    {item.location || ''}
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={colors.COLOR_BLACK_LIGHT_4} />
                        </TouchableOpacity>
                        <View style={styles.noteCardActions}>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => handleTogglePin(item.propertyId, item.note.id)} accessibilityLabel={t('common.edit')}>
                                <Ionicons name={item.note.isPinned ? 'pin' : 'pin-outline'} size={16} color={item.note.isPinned ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4} />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => handleToggleArchive(item.propertyId, item.note.id)} accessibilityLabel={t('common.update')}>
                                <Ionicons name={item.note.isArchived ? 'archive' : 'archive-outline'} size={18} color={colors.COLOR_BLACK_LIGHT_4} />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => handleDeleteNote(item.propertyId, item.note.id)} accessibilityLabel={t('common.delete')}>
                                <Ionicons name="trash-outline" size={18} color={colors.COLOR_BLACK_LIGHT_4} />
                            </TouchableOpacity>
                        </View>
                    </TouchableOpacity>
                )}
                ListFooterComponent={editing && (
                    <View style={styles.editor}>
                        <Text style={styles.editorTitle}>{editing.note ? t('saved.actions.editNotes') : t('saved.actions.addNotes')}</Text>
                        {!editing.propertyId && (
                            <View style={styles.propPicker}>
                                <Text style={styles.pickerLabel}>{t('common.select')}</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                    {savedProperties.map((p) => {
                                        const pid = (p._id || p.id) as string;
                                        const isSel = selectedPropertyId === pid;
                                        return (
                                            <TouchableOpacity key={pid} style={[styles.pill, isSel && styles.pillActive]} onPress={() => setSelectedPropertyId(pid)}>
                                                <Text style={[styles.pillText, isSel && styles.pillTextActive]}>{getPropertyTitle(p) || p.address?.city || 'Property'}</Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </ScrollView>
                            </View>
                        )}
                        <TextInput
                            style={styles.input}
                            value={text}
                            onChangeText={setText}
                            placeholder={t('saved.notes.placeholder')}
                            multiline
                            numberOfLines={4}
                        />
                        <View style={styles.editorActions}>
                            <Button onPress={() => { setEditing(null); setText(''); }} style={styles.cancelBtn}>{t('common.cancel')}</Button>
                            <Button onPress={handleSaveNote}>{t('common.save')}</Button>
                        </View>
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fafbfc',
    },
    content: {
        padding: 16,
        paddingBottom: 100,
    },
    tabsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#eaeaea',
    },
    tabItem: {
        paddingVertical: 8,
        paddingHorizontal: 8,
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    tabItemActive: {
        borderBottomColor: colors.primaryColor,
    },
    tabText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        fontWeight: '600',
    },
    tabTextActive: {
        color: colors.COLOR_BLACK,
    },
    gridRow: {
        justifyContent: 'space-between',
    },
    noteCard: {
        backgroundColor: 'white',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#eaeaea',
        padding: 12,
        marginBottom: 12,
        flex: 1,
        marginHorizontal: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
        elevation: 2,
    },
    archivedCard: {
        opacity: 0.6,
    },
    noteCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    cardTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.COLOR_BLACK,
        marginBottom: 8,
    },
    emptyText: {
        fontSize: 13,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginBottom: 8,
    },
    noteRow: {
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: '#f1f3f4',
    },
    noteText: {
        fontSize: 14,
        color: colors.COLOR_BLACK,
        marginBottom: 8,
    },
    previewCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderTopWidth: 1,
        borderTopColor: '#f1f3f4',
        paddingTop: 10,
    },
    previewImageL: {
        width: 44,
        height: 44,
        borderRadius: 8,
        backgroundColor: '#f0f0f0',
    },
    previewTitle: {
        fontSize: 13,
        color: colors.COLOR_BLACK,
        flex: 1,
    },
    previewMeta: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginTop: 2,
    },
    previewMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 2,
    },
    previewPrice: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    noteCardActions: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        gap: 4,
        marginTop: 8,
    },
    iconBtn: {
        padding: 6,
        borderRadius: 8,
    },
    noteActions: {
        flexDirection: 'row',
        gap: 12,
    },
    action: {
        fontSize: 13,
        color: colors.primaryColor,
        fontWeight: '600',
    },
    addBtn: {
        marginTop: 8,
    },
    editor: {
        backgroundColor: 'white',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#eaeaea',
        padding: 12,
        marginTop: 8,
    },
    propPicker: {
        marginBottom: 8,
    },
    pickerLabel: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginBottom: 6,
    },
    pill: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#eaeaea',
        marginRight: 8,
        backgroundColor: '#fff',
    },
    pillActive: {
        backgroundColor: colors.primaryLight,
        borderColor: colors.primaryColor,
    },
    pillText: {
        fontSize: 12,
        color: colors.COLOR_BLACK,
    },
    pillTextActive: {
        color: colors.primaryColor,
        fontWeight: '700',
    },
    editorTitle: {
        fontWeight: '700',
        marginBottom: 8,
        color: colors.COLOR_BLACK,
    },
    input: {
        borderWidth: 1,
        borderColor: '#eaeaea',
        borderRadius: 10,
        padding: 10,
        minHeight: 100,
        textAlignVertical: 'top',
    },
    editorActions: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 10,
        justifyContent: 'flex-end',
    },
    cancelBtn: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
    },
});
