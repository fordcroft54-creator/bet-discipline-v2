import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { iso, startOfMonth, startOfWeek } from "../lib/date";
import { supabase } from "../lib/supabase";
import { useAppStore } from "../store/useAppStore";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
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
  created_at: string;
  settled_at: string | null;
};

const DRIVERS = [
  { label: "😐 Bored", value: "bored" },
  { label: "😤 Chasing losses", value: "chasing_losses" },
  { label: "🎉 Feeling confident", value: "confident" },
  { label: "🧠 Strong edge", value: "edge" },
  { label: "🔁 Habit / routine", value: "habit" },
  { label: "👯 Social / with friends", value: "social" },
  { label: "🍺 Drinking", value: "drinking" },
  { label: "⚡ Impulsive", value: "impulsive" },
] as const;

type Driver = (typeof DRIVERS)[number]["value"];

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

export default function HomeScreen() {
  const revision = useAppStore((s) => s.revision);

  const [goals, setGoals] = useState<Goals | null>(null);
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  // --- NEW: friction state ---
  const [frictionOpen, setFrictionOpen] = useState(false);
  const [frictionType, setFrictionType] = useState<"weekly" | "monthly" | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [pendingNav, setPendingNav] = useState<"log" | null>(null);

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

      // goals
      const g = await supabase
        .from("goals")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (g.error) throw g.error;

      // last 90 days bets (enough for month/week)
      const since = new Date();
      since.setDate(since.getDate() - 90);

      const b = await supabase
        .from("bets")
        .select("stake,status,result,profit,emotion,created_at,settled_at")
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

  // initial load + store-based refresh
  useEffect(() => {
    load();
  }, [revision, load]);

  // refresh on focus (after settling, coming back, etc.)
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {};
    }, [load])
  );

  const weekStart = useMemo(() => startOfWeek(), []);
  const monthStart = useMemo(() => startOfMonth(), []);

  const weekBets = useMemo(
    () => bets.filter((b) => new Date(b.created_at) >= weekStart),
    [bets, weekStart]
  );

  const monthSettled = useMemo(() => {
    return bets.filter((b) => {
      if (b.status !== "settled") return false;
      const d = asDate(b.settled_at) ?? asDate(b.created_at);
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
    const s = bets.filter((b) => {
      if (b.status !== "settled") return false;
      const d = asDate(b.settled_at) ?? asDate(b.created_at);
      if (!d) return false;
      return d >= weekStart;
    });

    const wins = s.filter((b) => b.result === "win").length;
    const losses = s.filter((b) => b.result === "loss").length;
    return { total: s.length, wins, losses };
  }, [bets, weekStart]);

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
    weekBets.forEach((b) => set.add(new Date(b.created_at).toISOString().slice(0, 10)));
    return set.size;
  }, [weekBets]);

  const weeklyBudget = Number(goals?.weekly_budget ?? 0);
  const monthlyCap = Number(goals?.monthly_loss_cap ?? 0);

  const weeklyOver = weeklyBudget > 0 && weeklyWagered > weeklyBudget;
  const monthlyOver = monthlyCap > 0 && monthlyLosses > monthlyCap;

  const weeklyOverBy = weeklyOver ? weeklyWagered - weeklyBudget : 0;
  const monthlyOverBy = monthlyOver ? monthlyLosses - monthlyCap : 0;

  const weeklyPct = weeklyBudget > 0 ? Math.min(1, weeklyWagered / weeklyBudget) : 0;
  const monthlyPct =
    monthlyCap > 0 ? Math.min(1, Math.max(0, monthlyLosses / monthlyCap)) : 0;

  // --- NEW: open friction modal with context ---
  const openFriction = (type: "weekly" | "monthly") => {
    setDriver(null);
    setFrictionType(type);
    setFrictionOpen(true);
  };

  const tryNavigateToLog = () => {
    // If either cap is exceeded, require friction before allowing log navigation.
    if (weeklyOver) {
      setPendingNav("log");
      openFriction("weekly");
      return;
    }
    if (monthlyOver) {
      setPendingNav("log");
      openFriction("monthly");
      return;
    }
    router.push("../(tabs)/log");
  };

  const continueFromFriction = () => {
    if (!driver) {
      Alert.alert("Quick check-in", "What’s driving this bet right now?");
      return;
    }

    setFrictionOpen(false);

    // If we were gating navigation to Log, proceed now.
    if (pendingNav === "log") {
      setPendingNav(null);
      router.push("../(tabs)/log");
      return;
    }
  };

  const lowerStakeInstead = () => {
    // On Home you can't lower stake directly; best equivalent is to route to Goals edit.
    setFrictionOpen(false);
    setPendingNav(null);
    router.push("../(tabs)/profile");
  };

  // OPTIONAL: show an automatic one-time “exceeded” notice when the screen loads/focuses.
  // It’s light friction; the stronger friction is gating "+ Log New Bet" above.
  useEffect(() => {
    // don’t spam alerts; only show if modal not open already
    if (loading) return;
    if (frictionOpen) return;
    // If you want NO auto-pop, comment this block out.
    // if (weeklyOver || monthlyOver) openFriction(weeklyOver ? "weekly" : "monthly");
  }, [loading, weeklyOver, monthlyOver, frictionOpen]);

  if (loading) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: Theme.bg, justifyContent: "center", padding: 16 }}
      >
        <Text style={{ color: Theme.sub, fontWeight: "700" }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const frictionTitle =
    frictionType === "weekly"
      ? "⚠️ Weekly budget exceeded"
      : frictionType === "monthly"
      ? "⚠️ Monthly loss cap exceeded"
      : "⚠️ Limit exceeded";

  const frictionBody =
    frictionType === "weekly"
      ? `Budget: ${money(weeklyBudget)}\nUsed: ${money(weeklyWagered)}\nOver by: ${money(
          weeklyOverBy
        )}`
      : `Cap: ${money(monthlyCap)}\nLosses: ${money(monthlyLosses)}\nOver by: ${money(
          monthlyOverBy
        )}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
      {/* NEW: Friction modal used when user tries to log while over caps */}
      <Modal
        visible={frictionOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFrictionOpen(false)}
      >
        <Pressable
          onPress={() => setFrictionOpen(false)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.6)",
            padding: 16,
            justifyContent: "center",
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: Theme.card,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 16,
            }}
          >
            <Text style={{ color: Theme.text, fontSize: 18, fontWeight: "900" }}>
              {frictionTitle}
            </Text>

            <View style={{ height: 10 }} />

            <Text style={{ color: Theme.sub, fontWeight: "800", lineHeight: 18 }}>
              {frictionBody}
            </Text>

            <View style={{ height: 14 }} />

            <Text style={{ color: Theme.sub, fontWeight: "800" }}>
              What’s driving this bet right now?
            </Text>

            <View style={{ height: 10 }} />

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {DRIVERS.map((d) => (
                <Chip
                  key={d.value}
                  label={d.label}
                  selected={driver === d.value}
                  onPress={() => setDriver(d.value)}
                />
              ))}
            </View>

            <View style={{ height: 14 }} />

            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="Edit goals" onPress={lowerStakeInstead} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={() => {
                    setFrictionOpen(false);
                    setPendingNav(null);
                  }}
                />
              </View>
            </View>

            <View style={{ height: 10 }} />

            <Button title="Log anyway" onPress={continueFromFriction} />
            <View style={{ height: 6 }} />
            <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "700" }}>
              Tip: If this is “chasing losses,” try taking a 10-minute break or lowering stake.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={{ color: Theme.text, fontSize: 26, fontWeight: "900" }}>Home</Text>

        {/* THIS WEEK */}
        <View
          style={{
            backgroundColor: Theme.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: Theme.border,
            padding: 14,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18 }}>This Week</Text>
            {weeklyOver ? (
              <Text style={{ color: Theme.danger, fontWeight: "900" }}>
                Over {money(weeklyOverBy)}
              </Text>
            ) : null}
          </View>

          <Text style={{ color: Theme.sub, fontWeight: "700" }}>
            Weekly Wager Budget: {money(weeklyBudget)} • Used: {money(weeklyWagered)}
          </Text>

          <View
            style={{
              height: 10,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            {/* If over budget, keep bar full and danger color */}
            <View
              style={{
                width: `${(weeklyOver ? 1 : weeklyPct) * 100}%`,
                height: "100%",
                backgroundColor: weeklyOver ? Theme.danger : barColor(weeklyPct),
              }}
            />
          </View>

          <Text style={{ color: Theme.sub, fontWeight: "700" }}>
            {weeklyOver
              ? `Budget exceeded by ${money(weeklyOverBy)}`
              : `Remaining: ${money(Math.max(0, weeklyBudget - weeklyWagered))}`}
          </Text>

          <Text style={{ color: Theme.sub, fontWeight: "700", marginTop: 8 }}>
            Betting Days Used: {daysUsed} / {goals?.days_per_week ?? 0}
          </Text>
        </View>

        {/* THIS MONTH */}
        <View
          style={{
            backgroundColor: Theme.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: Theme.border,
            padding: 14,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18 }}>This Month</Text>
            {monthlyOver ? (
              <Text style={{ color: Theme.danger, fontWeight: "900" }}>
                Over {money(monthlyOverBy)}
              </Text>
            ) : null}
          </View>

          <Text style={{ color: Theme.sub, fontWeight: "700" }}>
            Monthly Loss Cap: {money(monthlyCap)} • Losses: {money(monthlyLosses)}
          </Text>

          <View
            style={{
              height: 10,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.08)",
              overflow: "hidden",
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

          {monthlyOver ? (
            <Text style={{ color: Theme.sub, fontWeight: "700" }}>
              Loss cap exceeded by {money(monthlyOverBy)}
            </Text>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 14,
              gap: 6,
            }}
          >
            <Text style={{ color: Theme.sub, fontWeight: "800" }}>Open Bets</Text>
            <Text style={{ color: Theme.text, fontSize: 22, fontWeight: "900" }}>
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
              padding: 14,
              gap: 6,
            }}
          >
            <Text style={{ color: Theme.sub, fontWeight: "800" }}>Settled (week)</Text>
            <Text style={{ color: Theme.text, fontSize: 18, fontWeight: "900" }}>
              {settledThisWeek.total} ({settledThisWeek.wins}W–{settledThisWeek.losses}L)
            </Text>
          </View>
        </View>

        {/* NEW: gate log button behind friction when exceeded */}
        <Button
          title={weeklyOver || monthlyOver ? "+ Log New Bet (Override)" : "+ Log New Bet"}
          onPress={tryNavigateToLog}
        />
        <Button
          title="Edit Goals"
          variant="secondary"
          onPress={() => router.push("../(tabs)/profile")}
        />
      </ScrollView>
    </SafeAreaView>
  );
}