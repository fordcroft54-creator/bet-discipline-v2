import React from "react";
import {
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    ViewProps
} from "react-native";
import { Theme } from "./Theme";

export function FormScreen({
  children,
  contentStyle,
}: {
  children: React.ReactNode;
  contentStyle?: ViewProps["style"];
}) {
  return (
    <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: Theme.bg }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            { padding: 16, paddingBottom: 90, gap: 14 },
            contentStyle,
          ]}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Pressable>
  );
}