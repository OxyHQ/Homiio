import React, { useRef, useEffect, useState, useContext } from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle, View, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import LoadingSpinner from './LoadingSpinner';
import { SaveToFolderBottomSheet } from './SaveToFolderBottomSheet';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { Property } from '@homiio/shared-types';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { getPropertyTitle } from '@/utils/propertyUtils';

const IconComponent = Ionicons as any;

interface SaveButtonProps {
    isSaved: boolean;
    onPress?: () => void; // Optional for backward compatibility
    onLongPress?: () => void;
    size?: number;
    style?: ViewStyle;
    disabled?: boolean;
    variant?: 'heart' | 'bookmark';
    color?: string;
    activeColor?: string;
    showLoading?: boolean;
    isLoading?: boolean;
    // Only need the property object
    property?: Property;
}

export function SaveButton({
    isSaved,
    onPress,
    onLongPress,
    size = 24,
    style,
    disabled = false,
    variant = 'heart',
    color = '#ccc',
    activeColor = '#EF4444',
    showLoading = true,
    isLoading = false,
    // Only need the property object
    property
}: SaveButtonProps) {
    const [isPressed, setIsPressed] = useState(false);
    const [internalLoading, setInternalLoading] = useState(false);
    const pressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isProcessingRef = useRef(false);
    const bottomSheetContext = useContext(BottomSheetContext);
    const { savePropertyToFolder, unsaveProperty, isPropertySaved, isInitialized } = useSavedPropertiesContext();

    // Extract propertyId and propertyTitle from property object
    const propertyId = property?._id || property?.id;
    const propertyTitle = property ? getPropertyTitle(property) : '';

    const getIconName = () => {
        if (variant === 'heart') {
            return isSaved ? 'heart' : 'heart-outline';
        } else {
            return isSaved ? 'bookmark' : 'bookmark-outline';
        }
    };

    const getIconColor = () => {
        return isSaved ? activeColor : color;
    };

    const isButtonDisabled = disabled || isLoading || internalLoading || isPressed;

    const handleInternalSave = async () => {
        if (!propertyId || isProcessingRef.current) return;

        try {
            isProcessingRef.current = true;
            setInternalLoading(true);

            if (isSaved) {
                // Property is saved, so unsave it
                await unsaveProperty(propertyId);
                console.log('Property unsaved');
            } else {
                // Property is not saved, so save it to default folder
                await savePropertyToFolder(propertyId, null);
                console.log('Property saved to default folder');
            }
        } catch (error) {
            console.error('Failed to toggle save:', error);
        } finally {
            setInternalLoading(false);
            isProcessingRef.current = false;
        }
    };

    const handlePress = () => {
        if (isButtonDisabled) return;

        setIsPressed(true);

        // Clear any existing timeout
        if (pressTimeoutRef.current) {
            clearTimeout(pressTimeoutRef.current);
        }

        // Set a timeout to prevent rapid clicks
        pressTimeoutRef.current = setTimeout(() => {
            setIsPressed(false);
        }, 1000); // 1 second debounce

        // Use internal save logic if propertyId is provided, otherwise use external onPress
        if (propertyId) {
            handleInternalSave();
        } else if (onPress) {
            onPress();
        }
    };

    const handleLongPress = () => {
        if (isButtonDisabled) return;

        // If custom onLongPress is provided, use it
        if (onLongPress) {
            onLongPress();
            return;
        }

        // If we have property info, show folder selection
        if (propertyId && propertyTitle && bottomSheetContext) {
            // If property is not saved, save it first, then open folder selection
            if (!isSaved) {
                handleInternalSave().then(() => {
                    setTimeout(() => {
                        bottomSheetContext.openBottomSheet(
                            <SaveToFolderBottomSheet
                                propertyId={propertyId}
                                propertyTitle={propertyTitle}
                                property={property}
                                onClose={() => {
                                    bottomSheetContext?.closeBottomSheet();
                                }}
                                onSave={(folderId: string | null) => {
                                    console.log('Property saved to folder:', folderId);
                                    // The bottom sheet will auto-close after saving
                                }}
                            />
                        );
                    }, 100);
                });
            } else {
                // Property is already saved, just open folder selection
                bottomSheetContext.openBottomSheet(
                    <SaveToFolderBottomSheet
                        propertyId={propertyId}
                        propertyTitle={propertyTitle}
                        property={property}
                        onClose={() => {
                            bottomSheetContext?.closeBottomSheet();
                        }}
                        onSave={(folderId: string | null) => {
                            console.log('Property saved to folder:', folderId);
                            // The bottom sheet will auto-close after saving
                        }}
                    />
                );
            }
        }
    };

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (pressTimeoutRef.current) {
                clearTimeout(pressTimeoutRef.current);
            }
        };
    }, []);

    return (
        <TouchableOpacity
            onPress={handlePress}
            onLongPress={handleLongPress}
            activeOpacity={0.7}
            disabled={isButtonDisabled}
            style={[
                styles.saveButton,
                isButtonDisabled && styles.disabledButton,
                style
            ]}
        >
            <View style={{
                width: size,
                height: size,
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                {showLoading && (isLoading || internalLoading) ? (
                    <LoadingSpinner
                        size={size * 0.8}
                        color={getIconColor()}
                        showText={false}
                    />
                ) : (
                    <IconComponent
                        name={getIconName()}
                        size={size}
                        color={getIconColor()}
                    />
                )}
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    saveButton: {
        backgroundColor: colors.primaryLight,
        borderRadius: 25,
        padding: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
        alignItems: 'center',
        justifyContent: 'center',
    },
    disabledButton: {
        opacity: 0.6,
    },
}); 