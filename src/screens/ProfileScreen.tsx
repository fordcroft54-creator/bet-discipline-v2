import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { useAppStore } from "../store/useAppStore";
import { Button } from "../ui/Button";
import { Theme } from "../ui/Theme";

function digitsAndDot(s: string) {
  const cleaned = (s ?? "").replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function formatCurrencyForDisplay(raw: string) {
  const n = Number(digitsAndDot(raw));
  if (!Number.isFinite(n)) return "";
  return digitsAndDot(String(n));
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEFAULT_LIMITS = {
  maxBet: "50",
  weeklyBudget: "200",
  monthlyLossCap: "500",
};

function CurrencyField({
  label,
  helper,
  valueRaw,
  onChangeRaw,
  placeholder = "0",
}: {
  label: string;
  helper: string;
  valueRaw: string;
  onChangeRaw: (raw: string) => void;
  placeholder?: string;
}) {
  const display = useMemo(() => formatCurrencyForDisplay(valueRaw), [valueRaw]);

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 15 }}>{label}</Text>
      <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 13, lineHeight: 18 }}>{helper}</Text>

      <View
        style={{
          backgroundColor: Theme.card,
          borderWidth: 1,
          borderColor: Theme.border,
          borderRadius: 14,
          paddingHorizontal: 12,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>$</Text>

        <TextInput
          value={display}
          onChangeText={(t) => onChangeRaw(digitsAndDot(t))}
          keyboardType="decimal-pad"
          returnKeyType="done"
          blurOnSubmit
          onSubmitEditing={() => Keyboard.dismiss()}
          placeholder={placeholder}
          placeholderTextColor={Theme.sub}
          selectionColor={Theme.text}
          style={{
            flex: 1,
            color: Theme.text,
            fontSize: 16,
            fontWeight: "800",
            padding: 0,
            margin: 0,
          }}
        />
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const bump = useAppStore((s) => s.bump);

  const [email, setEmail] = useState<string>("");

  const [maxBet, setMaxBet] = useState(DEFAULT_LIMITS.maxBet);
  const [weeklyBudget, setWeeklyBudget] = useState(DEFAULT_LIMITS.weeklyBudget);
  const [monthlyLossCap, setMonthlyLossCap] = useState(DEFAULT_LIMITS.monthlyLossCap);

  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  const userIdRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const didHydrateRef = useRef(false);
  const saveResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildPayload = useCallback(
    (userId: string) => ({
      user_id: userId,
      max_bet: Number(digitsAndDot(maxBet)) || 0,
      weekly_budget: Number(digitsAndDot(weeklyBudget)) || 0,
      monthly_loss_cap: Number(digitsAndDot(monthlyLossCap)) || 0,
    }),
    [maxBet, weeklyBudget, monthlyLossCap]
  );

  const doSave = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) {
      setSaveStatus("error");
      setSaveErrorMsg("Not logged in.");
      return;
    }

    setSaveStatus("saving");
    setSaveErrorMsg(null);

    try {
      const payload = buildPayload(userId);
      const { error } = await supabase.from("goals").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;

      bump();

      if (!mountedRef.current) return;

      setSaveStatus("saved");

      if (saveResetRef.current) clearTimeout(saveResetRef.current);
      saveResetRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        setSaveStatus("idle");
      }, 1200);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setSaveStatus("error");
      setSaveErrorMsg(e?.message ?? "Could not save limits");
    }
  }, [buildPayload, bump]);

  const scheduleAutosave = useCallback(() => {
    if (!userIdRef.current || !didHydrateRef.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    setSaveStatus("saving");
    setSaveErrorMsg(null);

    debounceRef.current = setTimeout(() => {
      doSave();
    }, 750);
  }, [doSave]);

  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!mountedRef.current) return;

        const user = data.user;
        setEmail(user?.email ?? "");
        userIdRef.current = user?.id ?? null;

        if (!user) {
          didHydrateRef.current = true;
          return;
        }

        const g = await supabase.from("goals").select("*").eq("user_id", user.id).maybeSingle();
        if (!mountedRef.current) return;
        if (g.error) throw g.error;

        if (g.data) {
          setMaxBet(String(g.data.max_bet ?? DEFAULT_LIMITS.maxBet));
          setWeeklyBudget(String(g.data.weekly_budget ?? DEFAULT_LIMITS.weeklyBudget));
          setMonthlyLossCap(String(g.data.monthly_loss_cap ?? DEFAULT_LIMITS.monthlyLossCap));
        } else {
          setMaxBet(DEFAULT_LIMITS.maxBet);
          setWeeklyBudget(DEFAULT_LIMITS.weeklyBudget);
          setMonthlyLossCap(DEFAULT_LIMITS.monthlyLossCap);

          const { error: seedError } = await supabase.from("goals").upsert(
            {
              user_id: user.id,
              max_bet: Number(DEFAULT_LIMITS.maxBet),
              weekly_budget: Number(DEFAULT_LIMITS.weeklyBudget),
              monthly_loss_cap: Number(DEFAULT_LIMITS.monthlyLossCap),
            },
            { onConflict: "user_id" }
          );

          if (seedError) throw seedError;
          bump();
        }

        didHydrateRef.current = true;
      } catch (e: any) {
        if (!mountedRef.current) return;
        didHydrateRef.current = true;
        setSaveStatus("error");
        setSaveErrorMsg(e?.message ?? "Could not load limits");
      }
    })();

    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (saveResetRef.current) clearTimeout(saveResetRef.current);
    };
  }, [bump]);

  useEffect(() => {
    scheduleAutosave();
  }, [maxBet, weeklyBudget, monthlyLossCap, scheduleAutosave]);

  const statusText = useMemo(() => {
    if (saveStatus === "saving") return "Saving…";
    if (saveStatus === "saved") return "Saved";
    if (saveStatus === "error") return saveErrorMsg ? `Couldn’t save: ${saveErrorMsg}` : "Couldn’t save";
    return "";
  }, [saveStatus, saveErrorMsg]);

  const retryDisabled = saveStatus === "saving";

  const signOut = async () => {
    try {
      setBusy(true);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      bump();
    } catch (e: any) {
      Alert.alert("Sign out failed", e?.message ?? "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  const sendFeedback = useCallback(() => {
    const subject = encodeURIComponent("Tilt Check feedback (v1)");
    const body = encodeURIComponent(
      "What I liked:\n\nWhat confused me:\n\nBug / issue:\n\nFeature request:\n\n"
    );
    const url = `mailto:fordcroft54@gmail.com?subject=${subject}&body=${body}`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Could not open email app", "Please email fordcroft54@gmail.com");
    });
  }, []);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Theme.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 28,
            gap: 14,
          }}
        >
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
              <Text style={{ color: Theme.text, fontSize: 26, fontWeight: "900" }}>Limits</Text>

              {!!statusText && (
                <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>{statusText}</Text>
              )}
            </View>

            <Text style={{ color: Theme.sub, fontWeight: "700", lineHeight: 20 }}>
              Set the rules you want to bet within. Tilt Check uses these limits to track how disciplined your
              betting is.
            </Text>
          </View>

          <View
            style={{
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 14,
              gap: 14,
            }}
          >
            <Text style={{ color: Theme.text, fontSize: 18, fontWeight: "900" }}>Your Betting Rules</Text>

            <CurrencyField
              label="Max Bet"
              helper="The most you want to risk on a single bet."
              valueRaw={maxBet}
              onChangeRaw={setMaxBet}
              placeholder={DEFAULT_LIMITS.maxBet}
            />

            <CurrencyField
              label="Weekly Budget"
              helper="The total amount you’re comfortable wagering in one week."
              valueRaw={weeklyBudget}
              onChangeRaw={setWeeklyBudget}
              placeholder={DEFAULT_LIMITS.weeklyBudget}
            />

            <CurrencyField
              label="Monthly Loss Cap"
              helper="The most you’re willing to lose in a month before stepping back."
              valueRaw={monthlyLossCap}
              onChangeRaw={setMonthlyLossCap}
              placeholder={DEFAULT_LIMITS.monthlyLossCap}
            />

            <View
              style={{
                marginTop: 2,
                paddingTop: 4,
                gap: 10,
              }}
            >
              <Text style={{ color: Theme.sub, fontWeight: "700" }}>You can update these anytime.</Text>

              <Button title="Log A Bet" onPress={() => router.push("/log")} />
            </View>

            {saveStatus === "error" && <Button title="Retry" onPress={doSave} disabled={retryDisabled} />}
          </View>

          <View
            style={{
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 14,
              gap: 10,
            }}
          >
            <Text style={{ color: Theme.text, fontSize: 18, fontWeight: "900" }}>Profile</Text>

            <Text style={{ color: Theme.sub, fontWeight: "700" }}>Signed in as</Text>
            <Text style={{ color: Theme.text, fontWeight: "900" }}>{email}</Text>

            <View style={{ height: 6 }} />

            <Button
              title={busy ? "Signing out…" : "Sign Out"}
              variant="secondary"
              onPress={signOut}
              disabled={busy}
            />
          </View>

          <View
            style={{
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 14,
              gap: 10,
            }}
          >
            <Text style={{ color: Theme.text, fontSize: 18, fontWeight: "900" }}>App Info</Text>

            <Text style={{ color: Theme.sub, fontWeight: "800" }}>Tilt Check App V1</Text>

            <Text style={{ color: Theme.sub, fontWeight: "700" }}>
              Found a bug or have an idea? Send feedback anytime.
            </Text>

            <Button title="Send Feedback" variant="secondary" onPress={sendFeedback} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}