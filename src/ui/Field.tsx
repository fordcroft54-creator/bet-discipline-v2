import React, { forwardRef } from "react";
import { Text, TextInput, TextInputProps, View } from "react-native";
import { Theme } from "./Theme";

type Props = {
  label: string;
} & TextInputProps;

export const Field = forwardRef<TextInput, Props>(({ label, ...props }, ref) => {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: Theme.sub, fontWeight: "700" }}>{label}</Text>

      <TextInput
        ref={ref}
        style={{
          backgroundColor: Theme.card,
          color: Theme.text,
          padding: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: Theme.border,
        }}
        // ✅ IMPORTANT: do NOT hardcode returnKeyType / blurOnSubmit here
        // ✅ Let the caller control them via props
        {...props}
      />
    </View>
  );
});

Field.displayName = "Field";