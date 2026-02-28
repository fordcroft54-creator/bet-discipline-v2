// app/_layout.tsx
import type { Session } from "@supabase/supabase-js";
import { Stack, useRouter, useSegments } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { supabase } from "../src/lib/supabase";

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);

  // Load initial session + subscribe to auth changes.
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        console.log("BOOT: starting getSession()");
        const { data, error } = await supabase.auth.getSession();

        console.log("BOOT: getSession done", {
          hasSession: !!data.session,
          userId: data.session?.user?.id,
          error: error?.message ?? null,
        });

        if (!mounted) return;
        setSession(data.session ?? null);
      } catch (e: any) {
        console.log("BOOT: getSession threw", e?.message ?? e);
        if (!mounted) return;
        setSession(null);
      } finally {
        if (!mounted) return;
        setBooting(false);
        console.log("BOOT: finished");
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      console.log("AUTH EVENT", event, { hasSession: !!s, userId: s?.user?.id });
      setSession(s ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ✅ Redirect based on session + current route
  useEffect(() => {
    if (booting) return;

    const first = segments[0]; // e.g. "auth", "(tabs)", "modal", "settle-bet"
    const inAuth = first === "auth";
    const hasSession = !!session;

    console.log("ROUTE CHECK", { booting, hasSession, first });

    // 1) Logged OUT users should go to /auth
    if (!hasSession && !inAuth) {
      router.replace("/auth");
      return;
    }

    // 2) Logged IN users should not stay on /auth
    if (hasSession && inAuth) {
      router.replace("/(tabs)/home"); // <-- change if your first tab route differs
      return;
    }

    // 3) Otherwise do nothing (allows standalone routes like /modal, /settle-bet)
  }, [session, booting, segments, router]);

  if (booting) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Route files under app/ */}
      <Stack.Screen name="auth" />
      <Stack.Screen name="(tabs)" />
      {/* standalone routes under app/, e.g. app/settle-bet.tsx, app/modal.tsx */}
      <Stack.Screen name="settle-bet" />
    </Stack>
  );
}