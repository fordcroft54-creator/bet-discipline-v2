import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    SafeAreaView,
    Text,
    View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { Theme } from "../ui/Theme";

/**
 * BetsScreen (updated)
 * - Adds WIN/Loss color highlighting (green/red) while keeping dark-mode Theme styling
 * - Keeps your existing schema + emotion label mapping
 */

type Bet = {
  id: string;
  created_at?: string | null;

  sport?: string | null;
  bet_type?: string | null;

  stake?: number | null;
  event_label?: string | null;

  status?: string | null;
  result?: string | null;
  profit?: number | null;

  // backward compatible
  emotion?: string | null;
  emotions?: string[] | null;

  confidence?: number | null; // 1..5
};

const EMOTION_LABEL_BY_VALUE: Record<string, string> = {
  bored: "😐 Bored",
  chasing_losses: "😤 Chasing losses",
  tilted: "😡 Tilted / frustrated",
  stressed: "😰 Stressed",
  drinking: "🍺 Drinking",
  impulsive: "⚡ Impulsive",

  habit: "🔁 Habit / routine",
  social: "👯 Social / with friends",
  confident: "🎉 Confident",
  fun: "🙂 Just for fun",

  pre_planned: "🧠 Pre-planned",
  within_budget: "💸 Within budget",
};

function tidy(s?: string | null) {
  if (!s) return "";
  return String(s).replace(/\s+/g, " ").trim();
}

function money(n: number) {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  return `$${abs.toFixed(0)}`;
}

function formatDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function confidenceLabel(n?: number | null) {
  if (!n || !Number.isFinite(n)) return "";
  if (n <= 2) return "Low";
  if (n === 3) return "Med";
  return "High";
}

export default function BetsScreen() {
  const router = useRouter();
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  // If your Theme already has success/danger colors, use them.
  // Otherwise these fallbacks look good on dark UI.
  const colors = useMemo(() => {
    const t: any = Theme;
    return {
      win: t.success ?? t.green ?? "#22c55e",
      loss: t.danger ?? t.red ?? "#ef4444",
      push: t.sub ?? "#9aa4b2",
      winBg: t.successBg ?? "rgba(34,197,94,0.14)",
      lossBg: t.dangerBg ?? "rgba(239,68,68,0.14)",
      pushBg: t.mutedBg ?? "rgba(148,163,184,0.10)",
      badgeBorder: t.border ?? "#2a3140",
    };
  }, []);

  const loadBets = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr) {
      Alert.alert("Auth error", userErr.message);
      setLoading(false);
      return;
    }

    if (!user) {
      setBets([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("bets")
      .select(
        "id,created_at,sport,bet_type,stake,event_label,status,result,profit,emotion,emotions,confidence"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      Alert.alert("Load error", error.message);
      setLoading(false);
      return;
    }

    setBets((data as Bet[]) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadBets();
    }, [loadBets])
  );

  const deleteBet = useCallback(
    async (id: string) => {
      Alert.alert("Delete bet?", "This cannot be undone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            // optimistic UI
            setBets((prev) => prev.filter((b) => b.id !== id));

            const { error } = await supabase.from("bets").delete().eq("id", id);

            if (error) {
              Alert.alert("Delete failed", error.message);
              loadBets();
            }
          },
        },
      ]);
    },
    [loadBets]
  );

  const goSettle = useCallback(
    (betId: string) => {
      router.push(`/settle-bet?betId=${encodeURIComponent(betId)}`);
    },
    [router]
  );

  const resultBadge = (resultRaw?: string | null) => {
    const r = String(resultRaw ?? "").toLowerCase();
    if (r === "win")
      return { label: "WIN", fg: colors.win, bg: colors.winBg, amountMode: "profit" as const };
    if (r === "loss")
      return { label: "LOSS", fg: colors.loss, bg: colors.lossBg, amountMode: "stake" as const };
    if (r === "push")
      return { label: "PUSH", fg: colors.push, bg: colors.pushBg, amountMode: "none" as const };
    return null;
  };

  const renderItem = ({ item }: { item: Bet }) => {
    const isSettled = (item.status ?? "").toLowerCase() === "settled";

    const sport = tidy(item.sport) || "Sport";
    const betType = tidy(item.bet_type) || "Bet";
    const header = `${sport} • ${betType}`;

    const eventLabel = tidy(item.event_label);
    const stake = Number(item.stake ?? 0);

    // Prefer new multi-select emotions[]; fall back to legacy emotion
    const rawEmotions: string[] = item.emotions?.length
      ? item.emotions
      : item.emotion
      ? [item.emotion]
      : [];

    const emotionText = rawEmotions.length
      ? rawEmotions.map((e) => EMOTION_LABEL_BY_VALUE[e] ?? e).join(", ")
      : "—";

    const conf = item.confidence ?? null;
    const confText =
      conf && Number.isFinite(conf)
        ? `${conf}/5 (${confidenceLabel(conf)})`
        : "—";

    const placed = formatDate(item.created_at);

    const badge = isSettled ? resultBadge(item.result) : null;
    const profit = typeof item.profit === "number" ? item.profit : null;

    return (
      <View
        style={{
          padding: 16,
          marginVertical: 8,
          marginHorizontal: 16,
          borderRadius: 14,
          backgroundColor: Theme.card,
          borderWidth: 1,
          borderColor: Theme.border,
        }}
      >
        {/* Header row with RESULT badge on the right when settled */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text style={{ fontWeight: "900", fontSize: 16, color: Theme.text, flex: 1 }}>
            {header}
          </Text>

          {badge ? (
            <View
              style={{
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 999,
                backgroundColor: badge.bg,
                borderWidth: 1,
                borderColor: Theme.border,
              }}
            >
              <Text style={{ color: badge.fg, fontWeight: "900", letterSpacing: 0.4 }}>
                {badge.label}
              </Text>
            </View>
          ) : null}
        </View>

        {eventLabel ? (
          <Text style={{ marginTop: 6, color: Theme.text, fontWeight: "800" }}>
            {eventLabel}
          </Text>
        ) : (
          <Text style={{ marginTop: 6, color: Theme.sub }}>
            (No game/event saved)
          </Text>
        )}

        <View style={{ marginTop: 10, gap: 6 }}>
          <Text style={{ color: Theme.sub }}>
            Stake:{" "}
            <Text style={{ color: Theme.text, fontWeight: "900" }}>
              {money(stake)}
            </Text>
            {placed ? <Text style={{ color: Theme.sub }}>  •  {placed}</Text> : null}
          </Text>

          <Text style={{ color: Theme.sub }}>
            Confidence:{" "}
            <Text style={{ color: Theme.text, fontWeight: "900" }}>
              {confText}
            </Text>
          </Text>

          <Text style={{ color: Theme.sub }}>
            Emotions:{" "}
            <Text style={{ color: Theme.text, fontWeight: "900" }}>
              {emotionText}
            </Text>
          </Text>
        </View>

        {/* Settled line with colored WIN/LOSS + amount */}
        {isSettled && badge ? (
          <View style={{ marginTop: 10 }}>
            <Text style={{ fontWeight: "900", color: badge.fg }}>
              {badge.label}
              {badge.amountMode === "profit" && profit !== null ? ` • Profit: ${money(profit)}` : ""}
              {badge.amountMode === "stake" ? ` • Lost: ${money(stake)}` : ""}
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: "row", marginTop: 12, gap: 10 }}>
          <Pressable
            onPress={() => goSettle(item.id)}
            disabled={isSettled}
            style={{
              backgroundColor: isSettled ? "#2a3140" : "#ffffff",
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 10,
            }}
          >
            <Text
              style={{
                color: isSettled ? "#9aa4b2" : "#0f1115",
                fontWeight: "900",
              }}
            >
              {isSettled ? "Settled" : "Settle"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => deleteBet(item.id)}
            style={{
              backgroundColor: "#3b1b1b",
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#5b2626",
            }}
          >
            <Text style={{ color: "#ffb4b4", fontWeight: "900" }}>Delete</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={bets}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <View style={{ padding: 16 }}>
              <Text style={{ color: Theme.sub }}>No bets yet.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}