// app/SettleBetScreen.tsx  (or wherever your route file lives)
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    SafeAreaView,
    Text,
    TextInput,
    View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { Theme } from "../ui/Theme";

type Result = "win" | "loss" | "push";

type Bet = {
  id: string;
  created_at?: string | null;

  // money fields
  stake?: number | null;
  status?: string | null;
  result?: Result | null;
  profit?: number | null;

  // possible title fields (your table might use one of these)
  title?: string | null;
  game?: string | null;
  event?: string | null;
  teams?: string | null;
  description?: string | null;
};

function money(n: number) {
  if (!Number.isFinite(n)) return "$0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toFixed(0)}`;
}

function startOfMonthISO(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function betTitle(bet: Bet | null) {
  if (!bet) return "Bet";
  return (
    bet.title ||
    bet.game ||
    bet.event ||
    bet.teams ||
    bet.description ||
    "Bet"
  );
}

export default function SettleBetScreen() {
  const router = useRouter();
  const { betId } = useLocalSearchParams<{ betId?: string }>();

  // --- Use your app Theme (so it matches the rest of the app EXACTLY) ---
  // We read keys defensively so this screen won’t crash if Theme uses slightly different names.
  const t = Theme as any;
  const pick = (keys: string[], fallback: string) =>
    keys.map((k) => t?.[k]).find((v) => typeof v === "string" && v.length) ??
    fallback;

  const colors = {
    bg: pick(["bg", "background", "screen", "page"], "#0b1220"),
    card: pick(["card", "surface", "panel"], "#0f172a"),
    text: pick(["text", "fg", "foreground"], "#e5e7eb"),
    muted: pick(["muted", "subtext", "secondaryText"], "#9ca3af"),
    border: pick(["border", "stroke", "divider"], "#24324a"),
    borderSoft: pick(["borderSoft", "dividerSoft"], pick(["border"], "#24324a")),
    inputBg: pick(["input", "inputBg", "field", "fieldBg"], pick(["card"], "#0f172a")),
    placeholder: pick(["placeholder", "placeholderText"], pick(["muted"], "#9ca3af")),
    primary: pick(["primary", "accent"], "#e5e7eb"),
    onPrimary: pick(["onPrimary", "primaryText"], pick(["bg", "background"], "#0b1220")),
    disabled: pick(["disabled", "disabledBg"], "#6b7280"),
  };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [bet, setBet] = useState<Bet | null>(null);

  const [result, setResult] = useState<Result | null>(null);
  const [profitText, setProfitText] = useState("");

  // later you can pull this from a goals table / profile
  const monthlyLimit = 800;
  const [monthNetLossSoFar, setMonthNetLossSoFar] = useState(0);

  useEffect(() => {
    const load = async () => {
      if (!betId || typeof betId !== "string") {
        Alert.alert("Missing bet", "No betId provided.");
        router.back();
        return;
      }

      setLoading(true);
      try {
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();

        if (userErr) throw userErr;
        if (!user) {
          Alert.alert("Not signed in", "Please sign in again.");
          router.back();
          return;
        }

        const { data: betRow, error: betErr } = await supabase
          .from("bets")
          .select("*")
          .eq("id", betId)
          .single();

        if (betErr) throw betErr;

        const b = (betRow ?? null) as Bet | null;
        if (!b) throw new Error("Bet not found.");

        setBet(b);

        if (b.result) setResult(b.result);
        if (typeof b.profit === "number") setProfitText(String(b.profit));

        const monthStart = startOfMonthISO(new Date());

        const { data: settled, error: monthErr } = await supabase
          .from("bets")
          .select("result, stake, profit")
          .eq("user_id", user.id)
          .eq("status", "settled")
          .gte("created_at", monthStart);

        if (monthErr) throw monthErr;

        // net loss: loss adds stake, win subtracts profit, push adds 0
        const net = (settled ?? []).reduce((acc: number, row: any) => {
          if (row.result === "loss") return acc + Number(row.stake || 0);
          if (row.result === "win") return acc - Number(row.profit || 0);
          return acc;
        }, 0);

        setMonthNetLossSoFar(net);
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "Failed to load bet.");
        router.back();
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [betId, router]);

  const stake = Number(bet?.stake ?? 0);

  const profitValue = useMemo(() => {
    const n = Number(profitText);
    if (!Number.isFinite(n)) return null;
    return n;
  }, [profitText]);

  const monthlyAfter = useMemo(() => {
    if (!bet || !result) return null;
    if (result === "loss") return monthNetLossSoFar + stake;
    if (result === "push") return monthNetLossSoFar;
    // win
    return monthNetLossSoFar - (profitValue ?? 0);
  }, [bet, result, monthNetLossSoFar, profitValue, stake]);

  const confirm = async () => {
    if (!bet) return;

    if (!result) {
      Alert.alert("Pick a result", "Select Win, Loss, or Push.");
      return;
    }

    let profitToSave: number | null = null;

    if (result === "win") {
      if (profitValue === null || profitValue <= 0) {
        Alert.alert(
          "Enter profit",
          "For a Win, enter a profit amount (example: 75)."
        );
        return;
      }
      profitToSave = profitValue;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("bets")
        .update({
          status: "settled",
          result,
          profit: profitToSave, // null for loss/push
          settled_at: new Date().toISOString(),
        })
        .eq("id", bet.id);

      if (error) throw error;

      router.back();
    } catch (e: any) {
      Alert.alert("Could not save", e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !bet) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <ActivityIndicator style={{ marginTop: 30 }} />
      </SafeAreaView>
    );
  }

  const pillStyle = (r: Result) => {
    const selected = result === r;
    return {
      flex: 1 as const,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center" as const,
      backgroundColor: selected ? colors.primary : colors.inputBg,
      borderColor: selected ? colors.primary : colors.border,
    };
  };

  const pillText = (r: Result) => {
    const selected = result === r;
    return {
      fontWeight: "800" as const,
      color: selected ? colors.onPrimary : colors.text,
    };
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ padding: 16 }}>
          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>
            Settle Bet
          </Text>

          <View
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>
              {betTitle(bet)}
            </Text>

            <Text style={{ marginTop: 6, color: colors.muted, fontWeight: "600" }}>
              Stake: {money(stake)}
            </Text>

            <Text style={{ marginTop: 18, fontSize: 16, fontWeight: "800", color: colors.text }}>
              Result
            </Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pressable onPress={() => setResult("win")} style={pillStyle("win")}>
                <Text style={pillText("win")}>Win</Text>
              </Pressable>

              <Pressable onPress={() => setResult("loss")} style={pillStyle("loss")}>
                <Text style={pillText("loss")}>Loss</Text>
              </Pressable>

              <Pressable onPress={() => setResult("push")} style={pillStyle("push")}>
                <Text style={pillText("push")}>Push</Text>
              </Pressable>
            </View>

            {result === "win" ? (
              <View style={{ marginTop: 16 }}>
                <Text style={{ fontSize: 16, fontWeight: "800", color: colors.text }}>
                  If Win:
                </Text>

                <Text style={{ marginTop: 10, fontWeight: "800", color: colors.text }}>
                  Profit:
                </Text>

                <View
                  style={{
                    marginTop: 8,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: colors.inputBg,
                  }}
                >
                  <TextInput
                    value={profitText}
                    onChangeText={setProfitText}
                    keyboardType="numeric"
                    placeholder="$ _______"
                    placeholderTextColor={colors.placeholder}
                    style={{ fontSize: 16, color: colors.text }}
                    selectionColor={colors.primary}
                  />
                </View>
              </View>
            ) : null}

            <View
              style={{
                marginTop: 18,
                borderTopWidth: 1,
                borderTopColor: colors.borderSoft,
                paddingTop: 14,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "900", color: colors.text }}>
                Monthly Loss After This:
              </Text>

              <Text style={{ marginTop: 8, fontSize: 18, fontWeight: "900", color: colors.text }}>
                {monthlyAfter === null
                  ? "--"
                  : `${money(monthlyAfter)} / ${money(monthlyLimit)}`}
              </Text>
            </View>

            <Pressable
              onPress={confirm}
              disabled={saving}
              style={{
                marginTop: 16,
                paddingVertical: 14,
                borderRadius: 14,
                backgroundColor: saving ? colors.disabled : colors.primary,
                alignItems: "center",
              }}
            >
              <Text style={{ color: colors.onPrimary, fontWeight: "900", fontSize: 16 }}>
                {saving ? "Saving..." : "Confirm Result"}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}