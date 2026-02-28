import React, { useEffect, useState } from "react";
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

export default function ProfileScreen() {
  const bump = useAppStore((s) => s.bump);

  const [email, setEmail] = useState<string>("");

  const [maxBet, setMaxBet] = useState("150");
  const [weeklyBudget, setWeeklyBudget] = useState("500");
  const [monthlyLossCap, setMonthlyLossCap] = useState("800");
  const [daysPerWeek, setDaysPerWeek] = useState("3");
  const [lockDaysOnCap, setLockDaysOnCap] = useState("7");

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;

      setEmail(data.user?.email ?? "");
      if (!data.user) return;

      const g = await supabase
        .from("goals")
        .select("*")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (!mounted) return;

      if (g.data) {
        setMaxBet(String(g.data.max_bet ?? 0));
        setWeeklyBudget(String(g.data.weekly_budget ?? 0));
        setMonthlyLossCap(String(g.data.monthly_loss_cap ?? 0));
        setDaysPerWeek(String(g.data.days_per_week ?? 0));
        setLockDaysOnCap(String(g.data.lock_days_on_cap ?? 0));
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const saveGoals = async () => {
    Keyboard.dismiss();
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error("Not logged in.");

      const payload = {
        user_id: user.id,
        max_bet: Number(maxBet) || 0,
        weekly_budget: Number(weeklyBudget) || 0,
        monthly_loss_cap: Number(monthlyLossCap) || 0,
        days_per_week: Number(daysPerWeek) || 0,
        lock_days_on_cap: Number(lockDaysOnCap) || 0,
      };

      const { error } = await supabase
        .from("goals")
        .upsert(payload, { onConflict: "user_id" });

      if (error) throw error;

      bump();
      Alert.alert("Saved", "Goals updated.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save goals");
    } finally {
      setBusy(false);
    }
  };

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
          {/* Title */}
          <Text style={{ color: Theme.text, fontSize: 26, fontWeight: "900" }}>
            Goals
          </Text>

          {/* Goals section card */}
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
              value={maxBet}
              onChangeText={setMaxBet}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={saveGoals}
            />

            <Field
              label="Weekly Wager Budget"
              value={weeklyBudget}
              onChangeText={setWeeklyBudget}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={saveGoals}
            />

            <Field
              label="Monthly Loss Cap"
              value={monthlyLossCap}
              onChangeText={setMonthlyLossCap}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={saveGoals}
            />

            <Field
              label="Betting Days / Week"
              value={daysPerWeek}
              onChangeText={setDaysPerWeek}
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={saveGoals}
            />

            <Field
              label="Lock # Of Days If Cap Hit"
              value={lockDaysOnCap}
              onChangeText={setLockDaysOnCap}
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={saveGoals}
            />

            <Button
              title={busy ? "Saving…" : "Save Goals"}
              onPress={saveGoals}
              disabled={busy}
            />
          </View>

          {/* Profile section moved LOWER, under goals */}
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

            <Text style={{ color: Theme.sub, fontWeight: "700" }}>
              Signed in as
            </Text>
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