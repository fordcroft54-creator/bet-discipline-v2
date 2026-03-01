import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { useAppStore } from "../store/useAppStore";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
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

export default function ProfileScreen() {
  const bump = useAppStore((s) => s.bump);

  const [email, setEmail] = useState<string>("");

  const [maxBet, setMaxBet] = useState("150");
  const [weeklyBudget, setWeeklyBudget] = useState("500");
  const [monthlyLossCap, setMonthlyLossCap] = useState("800");
  const [daysPerWeek, setDaysPerWeek] = useState("3");
  const [lockDaysOnCap, setLockDaysOnCap] = useState("7");

  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  const userIdRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const maxBetDisplay = useMemo(() => formatCurrencyForDisplay(maxBet), [maxBet]);
  const weeklyBudgetDisplay = useMemo(
    () => formatCurrencyForDisplay(weeklyBudget),
    [weeklyBudget]
  );
  const monthlyLossCapDisplay = useMemo(
    () => formatCurrencyForDisplay(monthlyLossCap),
    [monthlyLossCap]
  );

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

        const g = await supabase
          .from("goals")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!mountedRef.current) return;

        if (g.error) throw g.error;

        if (g.data) {
          setMaxBet(String(g.data.max_bet ?? 0));
          setWeeklyBudget(String(g.data.weekly_budget ?? 0));
          setMonthlyLossCap(String(g.data.monthly_loss_cap ?? 0));
          setDaysPerWeek(String(g.data.days_per_week ?? 0));
          setLockDaysOnCap(String(g.data.lock_days_on_cap ?? 0));
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
    lock_days_on_cap: Number(digitsAndDot(lockDaysOnCap)) || 0,
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

      const { error } = await supabase
        .from("goals")
        .upsert(payload, { onConflict: "user_id" });

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
  }, [maxBet, weeklyBudget, monthlyLossCap, daysPerWeek, lockDaysOnCap]);

  const statusText = useMemo(() => {
    if (saveStatus === "saving") return "Saving…";
    if (saveStatus === "saved") return "Saved";
    if (saveStatus === "error")
      return saveErrorMsg ? `Couldn’t save: ${saveErrorMsg}` : "Couldn’t save";
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
          <View
            style={{
              flexDirection: "row",
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ color: Theme.text, fontSize: 26, fontWeight: "900" }}>
              Goals
            </Text>

            {!!statusText && (
              <Text
                style={{
                  color: saveStatus === "error" ? Theme.sub : Theme.sub,
                  fontWeight: "800",
                  fontSize: 12,
                }}
              >
                {statusText}
              </Text>
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
            <Text style={{ color: Theme.text, fontSize: 18, fontWeight: "900" }}>
              Limits
            </Text>

            <Field
              label="Max Bet Size"
              value={maxBetDisplay}
              onChangeText={(t) => setMaxBet(digitsAndDot(t))}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
            />

            <Field
              label="Weekly Wager Budget"
              value={weeklyBudgetDisplay}
              onChangeText={(t) => setWeeklyBudget(digitsAndDot(t))}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
            />

            <Field
              label="Monthly Loss Cap"
              value={monthlyLossCapDisplay}
              onChangeText={(t) => setMonthlyLossCap(digitsAndDot(t))}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
            />

            <Field
              label="Betting Days / Week"
              value={daysPerWeek}
              onChangeText={(t) => setDaysPerWeek(digitsAndDot(t))}
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
            />

            <Field
              label="Lock # Of Days If Cap Hit"
              value={lockDaysOnCap}
              onChangeText={(t) => setLockDaysOnCap(digitsAndDot(t))}
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
            />

            {saveStatus === "error" && (
              <Button title="Retry" onPress={doSave} disabled={retryDisabled} />
            )}
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
            <Text style={{ color: Theme.text, fontSize: 18, fontWeight: "900" }}>
              Profile
            </Text>

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