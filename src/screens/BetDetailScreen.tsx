import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, SafeAreaView, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { useAppStore } from "../store/useAppStore";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Theme } from "../ui/Theme";

type Bet = {
  id: string;
  sport: string;
  bet_type: string;
  stake: number;
  event_label: string | null;
  emotion: string;
  status: "open" | "settled";
  result: "win" | "loss" | "push" | null;
  profit: number | null;
  created_at: string;
};

export default function BetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bump = useAppStore((s) => s.bump);

  const [bet, setBet] = useState<Bet | null>(null);
  const [loading, setLoading] = useState(true);

  const [result, setResult] = useState<"win" | "loss" | "push" | null>(null);
  const [profit, setProfit] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("bets").select("*").eq("id", id).single();
      if (error) throw error;
      setBet(data as any);
      setResult((data as any).result ?? null);
      setProfit((data as any).profit != null ? String((data as any).profit) : "");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not load bet");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const title = useMemo(() => {
    if (!bet) return "";
    return bet.event_label ?? `${bet.sport} • ${bet.bet_type}`;
  }, [bet]);

  const settle = async () => {
    if (!bet) return;
    if (!result) return Alert.alert("Pick a result", "Win, loss, or push.");

    const stake = Number(bet.stake);
    let profitNum: number;

    if (result === "loss") {
      profitNum = -Math.abs(stake);
    } else if (result === "push") {
      profitNum = 0;
    } else {
      const n = Number(profit);
      if (!Number.isFinite(n)) return Alert.alert("Profit needed", "Enter profit for a win (e.g., 90).");
      profitNum = n;
    }

    try {
      const { error } = await supabase
        .from("bets")
        .update({
          status: "settled",
          result,
          profit: profitNum,
          settled_at: new Date().toISOString(),
        })
        .eq("id", bet.id);

      if (error) throw error;

      bump();
      router.replace("../(tabs)/bets");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not settle bet");
    }
  };

  if (loading || !bet) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg, justifyContent: "center", padding: 16 }}>
        <Text style={{ color: Theme.sub, fontWeight: "700" }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const isSettled = bet.status === "settled";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg, padding: 16, gap: 12 }}>
      <Button title="← Back" variant="secondary" onPress={() => router.back()} />

      <Text style={{ color: Theme.text, fontSize: 22, fontWeight: "900" }}>{title}</Text>
      <Text style={{ color: Theme.sub, fontWeight: "700" }}>
        Stake: ${Number(bet.stake).toFixed(0)} • Emotion: {bet.emotion}
      </Text>

      <View style={{ height: 10 }} />

      <Text style={{ color: Theme.sub, fontWeight: "800" }}>Result</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button title="Win" variant={result === "win" ? "primary" : "secondary"} onPress={() => setResult("win")} style={{ flex: 1 }} />
        <Button title="Loss" variant={result === "loss" ? "danger" : "secondary"} onPress={() => setResult("loss")} style={{ flex: 1 }} />
        <Button title="Push" variant={result === "push" ? "primary" : "secondary"} onPress={() => setResult("push")} style={{ flex: 1 }} />
      </View>

      {result === "win" ? (
        <Field label="Profit (for win)" value={profit} onChangeText={setProfit} keyboardType="numeric" placeholder="e.g., 90" />
      ) : null}

      <Button title={isSettled ? "Already settled" : "Confirm Result"} onPress={settle} disabled={isSettled} />
    </SafeAreaView>
  );
}