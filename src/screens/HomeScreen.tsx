// src/screens/HomeScreen.tsx
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Image, SafeAreaView, ScrollView, Text, View } from "react-native";
import { iso, startOfMonth, startOfWeek } from "../lib/date";
import { supabase } from "../lib/supabase";
import { useAppStore } from "../store/useAppStore";
import { Button } from "../ui/Button";
import { Theme } from "../ui/Theme";

type Goals = {
  max_bet: number;
  weekly_budget: number;
  monthly_loss_cap: number;
  days_per_week: number;
  lock_days_on_cap: number;
};

type Bet = {
  stake: number | null;
  status: "open" | "settled";
  result: "win" | "loss" | "push" | null;
  profit: number | null;

  emotion: string | null;
  emotions?: string[] | null;
  confidence?: number | null;

  created_at: string;
  placed_at?: string | null;
  settled_at: string | null;
};

function barColor(pct: number) {
  if (pct >= 0.9) return Theme.danger;
  if (pct >= 0.7) return Theme.warn;
  return Theme.ok;
}

function asDate(s: string | null | undefined) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function money(n: number) {
  if (!Number.isFinite(n)) return "$0";
  return `$${Math.round(n).toLocaleString()}`;
}

function moneySigned(n: number) {
  if (!Number.isFinite(n) || n === 0) return "$0";
  const sign = n > 0 ? "+" : "-";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString()}`;
}

function betAnchorDate(b: Bet) {
  return asDate(b.placed_at) ?? asDate(b.created_at);
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

// Emotion risk weights (from your LogBetScreen emotion values)
const EMOTION_RISK: Record<string, number> = {
  // Planned (low)
  confident: 0,
  research: 0,
  system: 0,
  pre_planned: 0,

  // Fun (low/moderate)
  fun: 1,
  social: 2,
  habit: 3,

  // Impulse (moderate/high)
  bored: 6,
  fomo: 7,
  impulsive: 8,
  stressed: 9,
  drinking: 10,

  // Chasing (high)
  chasing_losses: 15,
  tilted: 14,
  revenge: 13,
  doubling_down: 15,
  desperate: 15,
};

function prettyDriver(s: string) {
  const map: Record<string, string> = {
    chasing_losses: "Chasing losses",
    tilted: "Tilted",
    desperate: "Desperate",
    doubling_down: "Doubling down",
    revenge: "Revenge betting",
    bored: "Bored / idle",
    fomo: "FOMO",
    impulsive: "Impulse",
    stressed: "Stressed",
    drinking: "Drinking",
    fun: "Just for fun",
    social: "Social / with friends",
    habit: "Habit / routine",
    confident: "Confident",
    research: "Research-based",
    system: "System play",
    pre_planned: "Pre-planned",
  };
  return map[s] ?? s.replace(/_/g, " ");
}

function tiltRiskLevel(score: number) {
  // Plain-language labels instead of “39/100” dominating the UI
  if (score >= 75) return { level: "Severe", color: Theme.danger };
  if (score >= 50) return { level: "High", color: Theme.warn };
  if (score >= 25) return { level: "Moderate", color: Theme.warn };
  return { level: "Low", color: Theme.ok };
}

function statusCopy(score: number) {
  // Make “Watchlist” self-explanatory
  if (score >= 75) return "You’re at high risk of tilt. Tighten guardrails now.";
  if (score >= 50) return "Warning zone — slow down and protect your budget.";
  if (score >= 25) return "Keep an eye on it — you’re trending toward tilt.";
  return "Looks steady — stay within your guardrails.";
}

function computeTiltRisk(args: {
  goals: { weeklyBudget: number; monthlyLossCap: number; maxBet: number };
  weeklyWagered: number;
  monthlyLosses: number;
  netProfitWeek: number;
  recentBets: Array<{
    stake: number;
    confidence?: number | null; // 1..5
    emotions?: string[] | null;
    emotion?: string | null;
  }>;
}) {
  const { goals, weeklyWagered, monthlyLosses, netProfitWeek, recentBets } = args;

  const weeklyBudget = Number(goals.weeklyBudget || 0);
  const monthlyCap = Number(goals.monthlyLossCap || 0);
  const maxBet = Number(goals.maxBet || 0);

  // A) Weekly pressure (0–30)
  const weeklyPct = weeklyBudget > 0 ? clamp(weeklyWagered / weeklyBudget, 0, 2) : 0;
  const weeklyPts = weeklyBudget > 0 ? clamp(weeklyPct * 20, 0, 30) : 0;

  // B) Monthly loss pressure (0–30)
  const monthlyPct = monthlyCap > 0 ? clamp(monthlyLosses / monthlyCap, 0, 2) : 0;
  const monthlyPts = monthlyCap > 0 ? clamp(monthlyPct * 22, 0, 30) : 0;

  // C) Recent performance / chasing proxy (0–15)
  const perfScale = weeklyBudget > 0 ? weeklyBudget : Math.max(weeklyWagered, 100);
  const perfPts = netProfitWeek < 0 ? clamp((-netProfitWeek / perfScale) * 15, 0, 15) : 0;

  // D) Emotion risk (0–15)
  const emotionSamples = recentBets.flatMap((b) => {
    const arr = (b.emotions && b.emotions.length
      ? b.emotions
      : b.emotion
        ? [b.emotion]
        : []) as string[];
    return arr.slice(0, 3);
  });

  const emotionAvg =
    emotionSamples.length > 0
      ? emotionSamples.reduce((s, e) => s + (EMOTION_RISK[e] ?? 4), 0) / emotionSamples.length
      : 0;

  const emotionPts = clamp(emotionAvg, 0, 15);

  // E) Confidence/stake mismatch (0–10): big stakes + low confidence
  const denom = maxBet > 0 ? maxBet : Math.max(...recentBets.map((b) => b.stake || 0), 100);

  const mismatchAvg =
    recentBets.length > 0
      ? recentBets.reduce((sum, b) => {
          const conf = clamp(Number(b.confidence ?? 3), 1, 5);
          const confNorm = (conf - 1) / 4; // 0..1
          const stakePct = clamp((b.stake || 0) / denom, 0, 1.5);
          const mismatch = (1 - confNorm) * stakePct;
          return sum + mismatch;
        }, 0) / recentBets.length
      : 0;

  const confidencePts = clamp(mismatchAvg * 10, 0, 10);

  const hasReactive = emotionSamples.some((e) =>
    ["chasing_losses", "tilted", "desperate", "doubling_down", "revenge"].includes(e)
  );

  let score = Math.round(clamp(weeklyPts + monthlyPts + perfPts + emotionPts + confidencePts, 0, 100));
  if (hasReactive && weeklyBudget > 0 && weeklyPct >= 0.7) score = Math.max(score, 30);

  const reasons: string[] = [];

  if (weeklyBudget > 0) {
    if (weeklyWagered > weeklyBudget) reasons.push(`Over weekly budget by ${money(weeklyWagered - weeklyBudget)}`);
    else reasons.push(`${money(Math.max(0, weeklyBudget - weeklyWagered))} wager budget left this week`);
  } else {
    reasons.push("Set a weekly budget to activate guardrails");
  }

  if (monthlyCap > 0) {
    if (monthlyLosses > monthlyCap) reasons.push(`Over loss cap by ${money(monthlyLosses - monthlyCap)}`);
    else reasons.push(`${money(Math.max(0, monthlyCap - monthlyLosses))} left in loss cap`);
  }

  if (emotionSamples.length) {
    const worst = [...emotionSamples].sort((a, b) => (EMOTION_RISK[b] ?? 0) - (EMOTION_RISK[a] ?? 0))[0];
    if (worst) reasons.push(`Recent driver: ${prettyDriver(worst)}`);
  }

  if (netProfitWeek < 0) reasons.push(`Down ${money(Math.abs(netProfitWeek))} this week`);

  // Label = status label (keep your vibe, but clearer)
  const label =
    score >= 75 ? "Lock It Down 🛑" :
    score >= 50 ? "Tilt Risk ⚠️" :
    score >= 25 ? "Watchlist 👀" :
    "Disciplined ✅";

  const dotColor =
    score >= 75 ? Theme.danger :
    score >= 50 ? Theme.warn :
    score >= 25 ? Theme.warn :
    Theme.ok;

  return { score, label, dotColor, reasons: reasons.slice(0, 3) };
}

export default function HomeScreen() {
  const revision = useAppStore((s) => s.revision);

  const [goals, setGoals] = useState<Goals | null>(null);
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        setGoals(null);
        setBets([]);
        return;
      }

      const g = await supabase.from("goals").select("*").eq("user_id", user.id).maybeSingle();
      if (g.error) throw g.error;

      const since = new Date();
      since.setDate(since.getDate() - 90);

      const b = await supabase
        .from("bets")
        .select("stake,status,result,profit,emotion,emotions,confidence,created_at,placed_at,settled_at")
        .eq("user_id", user.id)
        .gte("created_at", iso(since))
        .order("created_at", { ascending: false });

      if (b.error) throw b.error;

      setGoals((g.data as any) ?? null);
      setBets((b.data as any) ?? []);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [revision, load]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {};
    }, [load])
  );

  const weekStart = useMemo(() => startOfWeek(), []);
  const monthStart = useMemo(() => startOfMonth(), []);

  const weekBets = useMemo(() => {
    return bets.filter((b) => {
      const d = betAnchorDate(b);
      if (!d) return false;
      return d >= weekStart;
    });
  }, [bets, weekStart]);

  const weekSettled = useMemo(() => {
    return bets.filter((b) => {
      if (b.status !== "settled") return false;
      const d = asDate(b.settled_at) ?? betAnchorDate(b);
      if (!d) return false;
      return d >= weekStart;
    });
  }, [bets, weekStart]);

  const monthSettled = useMemo(() => {
    return bets.filter((b) => {
      if (b.status !== "settled") return false;
      const d = asDate(b.settled_at) ?? betAnchorDate(b);
      if (!d) return false;
      return d >= monthStart;
    });
  }, [bets, monthStart]);

  const weeklyWagered = useMemo(
    () => weekBets.reduce((sum, b) => sum + Number(b.stake || 0), 0),
    [weekBets]
  );

  const openCount = useMemo(() => bets.filter((b) => b.status === "open").length, [bets]);

  const settledThisWeek = useMemo(() => {
    const s = weekSettled;
    const wins = s.filter((b) => b.result === "win").length;
    const losses = s.filter((b) => b.result === "loss").length;
    return { total: s.length, wins, losses };
  }, [weekSettled]);

  const netProfitWeek = useMemo(() => {
    return weekSettled.reduce((sum, b) => {
      const stake = Number(b.stake || 0);
      const profit = Number(b.profit || 0);
      if (b.result === "win") return sum + profit;
      if (b.result === "loss") return sum - stake;
      return sum;
    }, 0);
  }, [weekSettled]);

  const monthlyLosses = useMemo(() => {
    return monthSettled.reduce((sum, b) => {
      const stake = Number(b.stake || 0);
      const profit = Number(b.profit || 0);
      if (b.result === "loss") return sum + stake;
      if (b.result === "win") return sum - profit;
      return sum;
    }, 0);
  }, [monthSettled]);

  const daysUsed = useMemo(() => {
    const set = new Set<string>();
    weekBets.forEach((b) => {
      const d = betAnchorDate(b);
      if (!d) return;
      set.add(d.toISOString().slice(0, 10));
    });
    return set.size;
  }, [weekBets]);

  const weeklyBudget = Number(goals?.weekly_budget ?? 0);
  const monthlyCap = Number(goals?.monthly_loss_cap ?? 0);

  const weeklyOver = weeklyBudget > 0 && weeklyWagered > weeklyBudget;
  const monthlyOver = monthlyCap > 0 && monthlyLosses > monthlyCap;

  const weeklyOverBy = weeklyOver ? weeklyWagered - weeklyBudget : 0;
  const monthlyOverBy = monthlyOver ? monthlyLosses - monthlyCap : 0;

  const weeklyPct = weeklyBudget > 0 ? Math.min(1, weeklyWagered / weeklyBudget) : 0;
  const monthlyPct = monthlyCap > 0 ? Math.min(1, Math.max(0, monthlyLosses / monthlyCap)) : 0;

  const goLog = () => router.push("/(tabs)/log");
  const goEditGoals = () => router.push("/(tabs)/goals");

  const BRAND_GREEN = Theme.ok;

  const recentForDiscipline = useMemo(() => {
    return weekBets
      .slice(0, 10)
      .map((b) => ({
        stake: Number(b.stake || 0),
        confidence: b.confidence ?? null,
        emotions: b.emotions ?? null,
        emotion: b.emotion ?? null,
      }))
      .filter((x) => x.stake > 0);
  }, [weekBets]);

  const discipline = useMemo(() => {
    return computeTiltRisk({
      goals: {
        weeklyBudget,
        monthlyLossCap: monthlyCap,
        maxBet: Number(goals?.max_bet ?? 0),
      },
      weeklyWagered,
      monthlyLosses,
      netProfitWeek,
      recentBets: recentForDiscipline,
    });
  }, [weeklyBudget, monthlyCap, goals, weeklyWagered, monthlyLosses, netProfitWeek, recentForDiscipline]);

  const risk = useMemo(() => tiltRiskLevel(discipline.score), [discipline.score]);

  const GAP = 10;
  const CARD_PAD = 12;
  const FOOTER_H = 128;

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg, justifyContent: "center", padding: 16 }}>
        <Text style={{ color: Theme.sub, fontWeight: "700" }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: GAP, paddingBottom: FOOTER_H + 24 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Image
            source={require("../../assets/appicon.png")}
            style={{ width: 40, height: 40, borderRadius: 12 }}
            resizeMode="contain"
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: Theme.text, fontSize: 20, fontWeight: "900" }}>Tilt Check</Text>
            <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "700" }}>
              You know ball. We know you.
            </Text>
          </View>
        </View>

        {/* Discipline Status (clearer + coach-y) */}
        <View
          style={{
            backgroundColor: Theme.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: Theme.border,
            padding: CARD_PAD,
            gap: 8,
          }}
        >
          {/* Top row */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 99,
                  backgroundColor: discipline.dotColor,
                }}
              />
              <Text style={{ color: Theme.sub, fontWeight: "900", letterSpacing: 0.6, fontSize: 12 }}>
                DISCIPLINE
              </Text>
            </View>

            {/* Plain-language risk first */}
            <View style={{ alignItems: "flex-end" }}>
  <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>
    Tilt Risk: <Text style={{ color: risk.color }}>{risk.level}</Text>
  </Text>
  <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 11, marginTop: 2, opacity: 0.85 }}>
    {discipline.score}/100
  </Text>
</View>
          </View>

          {/* Status label */}
          <Text style={{ color: Theme.text, fontSize: 18, fontWeight: "900" }}>
            {discipline.label}
          </Text>

          {/* What it means (this is the key “Watchlist clarity” fix) */}
          <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 13 }}>
            {statusCopy(discipline.score)}
          </Text>

          

          {/* Reasons */}
          <View style={{ gap: 4, marginTop: 2 }}>
            {(discipline.reasons ?? []).map((r, idx) => (
              <Text key={idx} style={{ color: Theme.sub, fontWeight: "700", fontSize: 13 }}>
                • {r}
              </Text>
            ))}
          </View>
        </View>

        {/* THIS WEEK */}
        <View
          style={{
            backgroundColor: Theme.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: Theme.border,
            padding: CARD_PAD,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: BRAND_GREEN }} />
              <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>This Week</Text>
            </View>

            {weeklyOver ? (
              <Text style={{ color: Theme.danger, fontWeight: "900", fontSize: 12 }}>
                Over {money(weeklyOverBy)}
              </Text>
            ) : null}
          </View>

          <Text numberOfLines={1} style={{ color: Theme.sub, fontWeight: "700", fontSize: 13 }}>
            Budget: {money(weeklyBudget)} • Used: {money(weeklyWagered)}
          </Text>

          <View
            style={{
              height: 9,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.08)",
              overflow: "hidden",
              marginTop: 2,
            }}
          >
            <View
              style={{
                width: `${(weeklyOver ? 1 : weeklyPct) * 100}%`,
                height: "100%",
                backgroundColor: weeklyOver ? Theme.danger : barColor(weeklyPct),
              }}
            />
          </View>

          {!weeklyOver ? (
            <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 13 }}>
              Remaining: {money(Math.max(0, weeklyBudget - weeklyWagered))}
            </Text>
          ) : null}

          <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 13, marginTop: 2 }}>
            Betting days: {daysUsed} / {goals?.days_per_week ?? 0}
          </Text>

          <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 13 }}>
            Tip: Smaller stakes after a loss streak.
          </Text>
        </View>

        {/* THIS MONTH */}
        <View
          style={{
            backgroundColor: Theme.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: Theme.border,
            padding: CARD_PAD,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: BRAND_GREEN }} />
              <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>This Month</Text>
            </View>

            {monthlyOver ? (
              <Text style={{ color: Theme.danger, fontWeight: "900", fontSize: 12 }}>
                Over {money(monthlyOverBy)}
              </Text>
            ) : null}
          </View>

          <Text numberOfLines={1} style={{ color: Theme.sub, fontWeight: "700", fontSize: 13 }}>
            Loss cap: {money(monthlyCap)} • Used: {money(monthlyLosses)}
          </Text>

          <View
            style={{
              height: 9,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.08)",
              overflow: "hidden",
              marginTop: 2,
            }}
          >
            <View
              style={{
                width: `${(monthlyOver ? 1 : monthlyPct) * 100}%`,
                height: "100%",
                backgroundColor: monthlyOver ? Theme.danger : barColor(monthlyPct),
              }}
            />
          </View>

          {!monthlyOver ? (
            <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 13 }}>
              Remaining: {money(Math.max(0, monthlyCap - monthlyLosses))}
            </Text>
          ) : null}

          <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 13 }}>
            Loss caps prevent spirals after a bad stretch.
          </Text>
        </View>

        {/* Quick stats */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: CARD_PAD,
              gap: 4,
            }}
          >
            <Text numberOfLines={1} style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>
              Open bets
            </Text>
            <Text style={{ color: Theme.text, fontSize: 20, fontWeight: "900" }}>
              {openCount}
            </Text>
          </View>

          <View
            style={{
              flex: 1,
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: CARD_PAD,
              gap: 2,
            }}
          >
            <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>
              Net (week)
            </Text>
            <Text
              style={{
                color: netProfitWeek >= 0 ? Theme.ok : Theme.danger,
                fontSize: 16,
                fontWeight: "900",
              }}
            >
              {moneySigned(netProfitWeek)}
            </Text>
          </View>

          <View
            style={{
              flex: 1,
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: CARD_PAD,
              gap: 2,
            }}
          >
            <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>
              Settled (week)
            </Text>
            <Text style={{ color: Theme.text, fontSize: 16, fontWeight: "900" }}>
              {settledThisWeek.total} ({settledThisWeek.wins}W–{settledThisWeek.losses}L)
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Fixed footer */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: 16,
          paddingTop: 12,
          backgroundColor: Theme.bg,
          borderTopWidth: 1,
          borderTopColor: Theme.border,
          gap: 10,
        }}
      >
        <Button title="+ Log Bet" onPress={goLog} />
        <Button title="Edit Guardrails" variant="secondary" onPress={goEditGoals} />
      </View>
    </SafeAreaView>
  );
}