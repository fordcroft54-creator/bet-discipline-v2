import React from "react";
import { Pressable, Text, ViewStyle } from "react-native";
import { Theme } from "./Theme";

export function Chip({
  label,
  selected,
  onPress,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        {
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: selected ? Theme.text : Theme.border,
          backgroundColor: selected ? "rgba(255,255,255,0.1)" : "transparent",
        },
        style,
      ]}
    >
      <Text style={{ color: Theme.text, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}