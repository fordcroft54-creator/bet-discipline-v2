import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { View } from "react-native";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

function TabIcon({
  focused,
  color,
  name,
}: {
  focused: boolean;
  color: string;
  name: FeatherName;
}) {
  return (
    <View
      style={{
        width: 44,
        height: 34,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: focused ? "rgba(255,255,255,0.08)" : "transparent",
      }}
    >
      <Feather name={name} size={focused ? 23 : 21} color={color} />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,

        // Dark tab bar styling (safe-area friendly)
        tabBarStyle: {
          backgroundColor: "#0B0E13",
          borderTopColor: "#1A1F2B",
          borderTopWidth: 1,
          paddingTop: 6,
          paddingBottom: 10,
          minHeight: 72,
        },

        tabBarLabelStyle: {
          fontSize: 11,
          marginTop: 2,
          fontWeight: "600",
        },

        tabBarActiveTintColor: "#FFFFFF",
        tabBarInactiveTintColor: "#6B7280",

        tabBarIcon: ({ color, focused }) => {
          let name: FeatherName = "circle";

          switch (route.name) {
            case "home":
              name = "home";
              break;
            case "insights":
              name = "bar-chart-2";
              break;
            case "log":
              name = "plus-circle";
              break;
            case "bets":
              name = "list";
              break;
            case "goals":
              name = "crosshair";
              break;
          }

          return <TabIcon focused={focused} color={color} name={name} />;
        },
      })}
    >
      {/* Hidden routes */}
      <Tabs.Screen name="index" options={{ href: null }} />

      {/* Visible tabs */}
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="insights" options={{ title: "Insights" }} />
      <Tabs.Screen name="log" options={{ title: "Log" }} />
      <Tabs.Screen name="bets" options={{ title: "Bets" }} />
      <Tabs.Screen name="goals" options={{ title: "Goals" }} />
    </Tabs>
  );
}