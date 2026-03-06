// app/_layout.tsx
import type { Session } from "@supabase/supabase-js";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { supabase } from "../src/lib/supabase";

SplashScreen.preventAutoHideAsync().catch(() => {
  // ignore if already called
});

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);

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

  useEffect(() => {
    if (booting) return;

    const first = segments[0];
    const inAuth = first === "auth";
    const hasSession = !!session;

    console.log("ROUTE CHECK", { booting, hasSession, first });

    if (!hasSession && !inAuth) {
      router.replace("/auth");
      return;
    }

    if (hasSession && inAuth) {
      router.replace("/(tabs)/home");
      return;
    }
  }, [session, booting, segments, router]);

  useEffect(() => {
    if (!booting) {
      SplashScreen.hideAsync().catch(() => {
        // ignore hide errors
      });
    }
  }, [booting]);

  if (booting) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="auth" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="settle-bet" />
    </Stack>
  );
}