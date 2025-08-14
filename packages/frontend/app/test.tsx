// app/index.tsx — simple BottomSheetModal example
import React, { useMemo, useRef } from "react";
import { View, Text, Button, StyleSheet } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";

export default function Home() {
    const sheetRef = useRef<BottomSheetModal>(null);
    const snapPoints = useMemo(() => ["25%", "60%"], []);

    const open = () => sheetRef.current?.present();
    const close = () => sheetRef.current?.dismiss();

    return (
        <View style={styles.container}>
            <Button title="Open Sheet" onPress={open} />
            <BottomSheetModal ref={sheetRef} snapPoints={snapPoints}>
                <BottomSheetView style={styles.content}>
                    <Text style={styles.title}>Hello from the sheet</Text>
                    <Button title="Close" onPress={close} />
                </BottomSheetView>
            </BottomSheetModal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, alignItems: "center", justifyContent: "center" },
    content: { flex: 1, padding: 16 },
    title: { fontSize: 18, fontWeight: "600", marginBottom: 12 },
});
