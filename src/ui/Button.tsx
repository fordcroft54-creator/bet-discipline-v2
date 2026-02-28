import React from "react";
import { Pressable, Text, ViewStyle } from "react-native";
import { Theme } from "./Theme";

export function Button({
  title,
  onPress,
  disabled,
  style,
  variant = "primary",
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  variant?: "primary" | "secondary" | "danger";
}) {
  const bg =
    variant === "danger"
      ? Theme.danger
      : variant === "secondary"
      ? "transparent"
      : Theme.text;

  const border =
    variant === "secondary" ? { borderWidth: 1, borderColor: Theme.border } : null;

  const textColor = variant === "primary" ? Theme.bg : Theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          backgroundColor: bg,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: 12,
          opacity: disabled ? 0.5 : 1,
          alignItems: "center",
        },
        border as any,
        style,
      ]}
    >
      <Text style={{ color: textColor, fontWeight: "800", fontSize: 16 }}>
        {title}
      </Text>
    </Pressable>
  );
}