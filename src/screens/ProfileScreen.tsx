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
  if (!Number.isFinite(n)) return "$";
  return `$${digitsAndDot(String(n))}`;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function CurrencyField({
  label,
  valueRaw,
  onChangeRaw,
  placeholder = "0",
}: {
  label: string;
  valueRaw: string;
  onChangeRaw: (raw: string) => void;
  placeholder?: string;
}) {
  const display = useMemo(() => formatCurrencyForDisplay(valueRaw), [valueRaw]);

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: Theme.sub, fontWeight: "800" }}>{label}</Text>

      <View
        style={{
          backgroundColor: Theme.card,
          borderWidth: 1,
          borderColor: Theme.border,
          borderRadius: 14,
          paddingHorizontal: 12,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>$</Text>

        <TextInput
          value={digitsAndDot(display.replace("$", ""))}
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

function NumberField({
  label,
  valueRaw,
  onChangeRaw,
  placeholder = "0",
}: {
  label: string;
  valueRaw: string;
  onChangeRaw: (raw: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: Theme.sub, fontWeight: "800" }}>{label}</Text>

      <View
        style={{
          backgroundColor: Theme.card,
          borderWidth: 1,
          borderColor: Theme.border,
          borderRadius: 14,
          paddingHorizontal: 12,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <TextInput
          value={valueRaw}
          onChangeText={(t) => onChangeRaw(digitsAndDot(t))}
          keyboardType="number-pad"
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
  const bump = useAppStore((s) => s.bump);

  const [email, setEmail] = useState<string>("");

  const [maxBet, setMaxBet] = useState("150");
  const [weeklyBudget, setWeeklyBudget] = useState("500");
  const [monthlyLossCap, setMonthlyLossCap] = useState("800");
  const [daysPerWeek, setDaysPerWeek] = useState("3");

  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  const userIdRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

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
        if (!user) return;

        const g = await supabase.from("goals").select("*").eq("user_id", user.id).maybeSingle();

        if (!mountedRef.current) return;

        if (g.error) throw g.error;

        if (g.data) {
          setMaxBet(String(g.data.max_bet ?? 0));
          setWeeklyBudget(String(g.data.weekly_budget ?? 0));
          setMonthlyLossCap(String(g.data.monthly_loss_cap ?? 0));
          setDaysPerWeek(String(g.data.days_per_week ?? 0));
        }
      } catch (e: any) {
        setSaveStatus("error");
        setSaveErrorMsg(e?.message ?? "Could not load goals");
      }
    })();

    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const buildPayload = (userId: string) => ({
    user_id: userId,
    max_bet: Number(digitsAndDot(maxBet)) || 0,
    weekly_budget: Number(digitsAndDot(weeklyBudget)) || 0,
    monthly_loss_cap: Number(digitsAndDot(monthlyLossCap)) || 0,
    days_per_week: Number(digitsAndDot(daysPerWeek)) || 0,
  });

  const doSave = async () => {
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

      setTimeout(() => {
        if (!mountedRef.current) return;
        setSaveStatus("idle");
      }, 1200);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setSaveStatus("error");
      setSaveErrorMsg(e?.message ?? "Could not save goals");
    }
  };

  const scheduleAutosave = () => {
    if (!userIdRef.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    setSaveStatus("saving");
    setSaveErrorMsg(null);

    debounceRef.current = setTimeout(() => {
      doSave();
    }, 750);
  };

  useEffect(() => {
    if (!userIdRef.current) return;
    scheduleAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxBet, weeklyBudget, monthlyLossCap, daysPerWeek]);

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
          <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
            {/* ✅ Title changed */}
            <Text style={{ color: Theme.text, fontSize: 26, fontWeight: "900" }}>Limits</Text>

            {!!statusText && (
              <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>{statusText}</Text>
            )}
          </View>

          <View
            style={{
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 14,
              gap: 12,
            }}
          >
            <Text style={{ color: Theme.text, fontSize: 18, fontWeight: "900" }}>Limits</Text>

            <CurrencyField label="Max Bet Size" valueRaw={maxBet} onChangeRaw={setMaxBet} placeholder="150" />

            <CurrencyField
              label="Weekly Wager Budget"
              valueRaw={weeklyBudget}
              onChangeRaw={setWeeklyBudget}
              placeholder="500"
            />

            <CurrencyField
              label="Monthly Loss Cap"
              valueRaw={monthlyLossCap}
              onChangeRaw={setMonthlyLossCap}
              placeholder="800"
            />

            <NumberField
              label="Betting Days / Week"
              valueRaw={daysPerWeek}
              onChangeRaw={setDaysPerWeek}
              placeholder="3"
            />

            {saveStatus === "error" && <Button title="Retry" onPress={doSave} disabled={retryDisabled} />}
          </View>

          {/* ✅ NEW: App Info */}
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

          <View style={{ height: 6 }} />

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
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}