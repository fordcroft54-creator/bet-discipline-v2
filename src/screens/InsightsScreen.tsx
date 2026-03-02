import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { iso } from "../lib/date";
import { supabase } from "../lib/supabase";
import { useAppStore } from "../store/useAppStore";
import { Theme } from "../ui/Theme";

type Bet = {
  stake: number;
  emotion: string | null;
  emotions?: string[] | null;
  confidence?: number | null;
  sport?: string | null;
  bet_type?: string | null;

  status: "open" | "settled";
  result: "win" | "loss" | "push" | null;
  profit: number | null;
  settled_at: string | null;

  created_at?: string | null;
  placed_at?: string | null; // ✅ NEW: actual bet date
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

function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return "$0";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(0)}`;
}

function pct(n: number) {
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n * 100)}%`;
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function tidy(s?: string | null) {
  if (!s) return "";
  return String(s).replace(/\s+/g, " ").trim();
}

function titleCase(s: string) {
  const t = tidy(s);
  if (!t) return "";
  return t
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** ✅ Confidence labels match LogBet:
 *  1=Very low, 2=Low, 3=Medium, 4=High, 5=Very high
 */
function confidenceLabel(n?: number | null) {
  if (n == null) return "";
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return "";
  if (x <= 1) return "Very low";
  if (x === 2) return "Low";
  if (x === 3) return "Medium";
  if (x === 4) return "High";
  return "Very high";
}

function Bar({
  value,
  labelLeft,
  labelRight,
}: {
  value: number;
  labelLeft?: string;
  labelRight?: string;
}) {
  const v = clamp01(value);
  return (
    <View style={{ gap: 6 }}>
      {labelLeft || labelRight ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>
            {labelLeft ?? ""}
          </Text>
          <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>
            {labelRight ?? ""}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          height: 10,
          backgroundColor: "#222838",
          borderRadius: 999,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: Theme.border,
        }}
      >
        <View
          style={{
            width: `${Math.round(v * 100)}%`,
            height: "100%",
            backgroundColor: "#ffffff",
            opacity: 0.9,
          }}
        />
      </View>
    </View>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: Theme.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: Theme.border,
        padding: 14,
        gap: 6,
        minWidth: 140,
      }}
    >
      <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>
        {label}
      </Text>
      <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 20 }}>
        {value}
      </Text>
      {sub ? (
        <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 12 }}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
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
      <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

type RangeKey = "7d" | "30d" | "90d" | "ytd" | "all";

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
];

function rangeLabel(k: RangeKey) {
  if (k === "7d") return "Last 7 days";
  if (k === "30d") return "Last 30 days";
  if (k === "90d") return "Last 90 days";
  if (k === "ytd") return "Year to date";
  return "All time";
}

function startForRange(k: RangeKey) {
  const now = new Date();
  if (k === "all") return null;

  if (k === "ytd") {
    const d = new Date(now);
    d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const days = k === "7d" ? 7 : k === "30d" ? 30 : 90;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}

function daysForRange(k: RangeKey) {
  if (k === "7d") return 7;
  if (k === "30d") return 30;
  if (k === "90d") return 90;
  return null;
}

/** ✅ Always use actual bet date for analytics.
 * If placed_at is missing (older rows), fall back to created_at.
 */
function betDateIso(b: Bet) {
  return b.placed_at ?? b.created_at ?? null;
}

/** ✅ Risk mix fix:
 * Your example (confident + within_budget) was showing "mid" because MID included "confident"
 * and the old logic sets mid first, and low only if still unknown.
 *
 * New rule:
 * - If ANY high-risk emotion -> high
 * - Else if ANY low-risk emotion -> low  (even if confident/habit/social/etc also selected)
 * - Else if any mid -> mid
 * - Else unknown
 */
function classifyRiskFromEmotions(vals: string[]) {
  const HIGH = new Set<string>([
    "chasing_losses",
    "tilted",
    "stressed",
    "drinking",
    "impulsive",
    "bored",
  ]);
  const MID = new Set<string>(["habit", "social", "confident", "fun"]);
  const LOW = new Set<string>(["pre_planned", "within_budget"]);

  const keys = vals.map((v) => tidy(v)).filter(Boolean);

  if (keys.some((k) => HIGH.has(k))) return "high" as const;
  if (keys.some((k) => LOW.has(k))) return "low" as const;
  if (keys.some((k) => MID.has(k))) return "mid" as const;
  return "unknown" as const;
}

export default function InsightsScreen() {
  const revision = useAppStore((s) => s.revision);

  const [range, setRange] = useState<RangeKey>("30d");

  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  // previous-window comparison stats (only for 7/30/90)
  const [prevNet, setPrevNet] = useState<number | null>(null);
  const [prevWinRate, setPrevWinRate] = useState<number | null>(null);
  const [prevHasSettled, setPrevHasSettled] = useState<boolean>(false);

  const normalizedProfit = useCallback((b: Bet) => {
    const p = Number(b.profit ?? 0);
    const stake = Number(b.stake ?? 0);

    if (b.result === "win") return Number.isFinite(p) ? p : 0;

    if (b.result === "loss") {
      if (Number.isFinite(p) && p !== 0) return p;
      return -stake;
    }

    if (b.result === "push") return 0;
    return 0;
  }, []);

  const computeWindowStats = useCallback(
    (rows: Bet[]) => {
      const settled = rows.filter((b) => b.status === "settled" && b.result !== null);
      const wins = settled.filter((b) => b.result === "win").length;
      const losses = settled.filter((b) => b.result === "loss").length;
      const total = settled.length;
      const winRate = total ? wins / total : 0;
      const net = settled.reduce((sum, b) => sum + normalizedProfit(b), 0);
      return { hasSettled: total > 0, winRate, net, wins, losses, total };
    },
    [normalizedProfit]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      const user = userData.user;
      if (!user) {
        setBets([]);
        setPrevNet(null);
        setPrevWinRate(null);
        setPrevHasSettled(false);
        return;
      }

      const start = startForRange(range);

      // ✅ pull placed_at as well
      let q = supabase
        .from("bets")
        .select(
          "stake,emotion,emotions,confidence,sport,bet_type,status,result,profit,settled_at,created_at,placed_at"
        )
        .eq("user_id", user.id);

      // ✅ filter by placed_at (fallback handling below)
      // Note: for older rows with placed_at NULL, Supabase can't include them with gte(placed_at).
      // We handle that by:
      //  - fetching the range using placed_at when possible
      //  - AND still allowing older null-placed_at rows by fetching them and filtering locally (small datasets).
      //
      // For simplicity + correctness, we do a single fetch (all) when range != all,
      // then filter locally using betDateIso. Most apps at your size won't be huge.
      let rows: Bet[] = [];

      if (start) {
        const { data, error } = await q.order("placed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
        if (error) throw error;
        const allRows = ((data as any) ?? []) as Bet[];
        rows = allRows.filter((b) => {
          const dIso = betDateIso(b);
          if (!dIso) return false;
          const d = new Date(dIso);
          return Number.isFinite(d.getTime()) && d >= start;
        });
      } else {
        const { data, error } = await q
          .order("placed_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });
        if (error) throw error;
        rows = ((data as any) ?? []) as Bet[];
      }

      setBets(rows);

      // previous window compare (only 7/30/90)
      const days = daysForRange(range);
      if (!days || !start) {
        setPrevNet(null);
        setPrevWinRate(null);
        setPrevHasSettled(false);
      } else {
        const prevEnd = new Date(start);
        const prevStart = new Date(start);
        prevStart.setDate(prevStart.getDate() - days);

        // ✅ same approach: fetch then local filter so placed_at NULL rows behave consistently
        const { data: prevData, error: prevErr } = await supabase
          .from("bets")
          .select(
            "stake,emotion,emotions,confidence,sport,bet_type,status,result,profit,settled_at,created_at,placed_at"
          )
          .eq("user_id", user.id)
          .order("placed_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });

        if (prevErr) throw prevErr;

        const prevAll = ((prevData as any) ?? []) as Bet[];
        const prevRows = prevAll.filter((b) => {
          const dIso = betDateIso(b);
          if (!dIso) return false;
          const d = new Date(dIso);
          return Number.isFinite(d.getTime()) && d >= prevStart && d < prevEnd;
        });

        const prev = computeWindowStats(prevRows);
        setPrevNet(prev.net);
        setPrevWinRate(prev.winRate);
        setPrevHasSettled(prev.hasSettled);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not load insights");
    } finally {
      setLoading(false);
    }
  }, [range, computeWindowStats]);

  useEffect(() => {
    load();
  }, [revision, load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const settled = useMemo(() => bets.filter((b) => b.status === "settled"), [bets]);
  const open = useMemo(() => bets.filter((b) => b.status !== "settled"), [bets]);
  const settledWithResult = useMemo(
    () => settled.filter((b) => b.result !== null),
    [settled]
  );

  const overall = useMemo(() => {
    const wins = settledWithResult.filter((b) => b.result === "win").length;
    const losses = settledWithResult.filter((b) => b.result === "loss").length;
    const pushes = settledWithResult.filter((b) => b.result === "push").length;

    const total = settledWithResult.length;
    const winRate = total > 0 ? wins / total : 0;

    const totalStakedSettled = settledWithResult.reduce(
      (sum, b) => sum + Number(b.stake ?? 0),
      0
    );

    const net = settledWithResult.reduce((sum, b) => sum + normalizedProfit(b), 0);

    const avgStake = total > 0 ? totalStakedSettled / total : 0;
    const roi = totalStakedSettled > 0 ? net / totalStakedSettled : 0;

    const emoCounts: Record<string, number> = {};
    for (const b of bets) {
      const raw: string[] =
        b.emotions && b.emotions.length
          ? (b.emotions as any)
          : b.emotion
          ? ([b.emotion] as any)
          : [];
      const keys = raw.length ? raw : ["unknown"];
      for (const e of keys) {
        const key = tidy(e) || "unknown";
        emoCounts[key] = (emoCounts[key] ?? 0) + 1;
      }
    }

    const topEmotion =
      Object.entries(emoCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      wins,
      losses,
      pushes,
      total,
      winRate,
      net,
      avgStake,
      roi,
      totalStakedSettled,
      openCount: open.length,
      totalCount: bets.length,
      topEmotion,
    };
  }, [bets, open.length, settledWithResult, normalizedProfit]);

  const deltas = useMemo(() => {
    const canCompare = prevNet !== null && prevWinRate !== null && prevHasSettled;
    if (!canCompare) {
      return {
        canCompare: false as const,
        netDeltaPct: null as number | null,
        winDeltaPts: null as number | null,
      };
    }

    const netDeltaPct =
      prevNet === 0
        ? overall.net === 0
          ? 0
          : overall.net > 0
          ? 1
          : -1
        : (overall.net - prevNet) / Math.abs(prevNet);

    const winDeltaPts = overall.winRate - (prevWinRate ?? 0);

    return { canCompare: true as const, netDeltaPct, winDeltaPts };
  }, [overall.net, overall.winRate, prevNet, prevWinRate, prevHasSettled]);

  const riskMix = useMemo(() => {
    let high = 0;
    let mid = 0;
    let low = 0;

    for (const b of bets) {
      const raw: string[] =
        b.emotions && b.emotions.length
          ? (b.emotions as any)
          : b.emotion
          ? ([b.emotion] as any)
          : [];
      const keys = raw.length ? raw : ["unknown"];

      const level = classifyRiskFromEmotions(keys);
      if (level === "high") high += 1;
      else if (level === "low") low += 1;
      else if (level === "mid") mid += 1;
    }

    const total = bets.length || 1;
    return {
      high,
      mid,
      low,
      highPct: high / total,
      midPct: mid / total,
      lowPct: low / total,
    };
  }, [bets]);

  const betTypeRows = useMemo(() => {
    const map: Record<string, { total: number; wins: number; net: number; stakeSum: number }> = {};

    for (const b of settledWithResult) {
      const k = tidy(b.bet_type) || "Unknown";
      map[k] = map[k] ?? { total: 0, wins: 0, net: 0, stakeSum: 0 };
      map[k].total += 1;
      map[k].wins += b.result === "win" ? 1 : 0;
      map[k].stakeSum += Number(b.stake ?? 0);
      map[k].net += normalizedProfit(b);
    }

    return Object.entries(map)
      .map(([betType, v]) => ({
        betType,
        label: betType === "Unknown" ? "Unknown / not saved" : titleCase(betType),
        total: v.total,
        winRate: v.total ? v.wins / v.total : 0,
        avgStake: v.total ? v.stakeSum / v.total : 0,
        net: v.net,
        roi: v.stakeSum > 0 ? v.net / v.stakeSum : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [settledWithResult, normalizedProfit]);

  const sportRows = useMemo(() => {
    const map: Record<string, { total: number; wins: number; net: number; stakeSum: number }> = {};

    for (const b of settledWithResult) {
      const k = tidy(b.sport) || "Unknown";
      map[k] = map[k] ?? { total: 0, wins: 0, net: 0, stakeSum: 0 };
      map[k].total += 1;
      map[k].wins += b.result === "win" ? 1 : 0;
      map[k].stakeSum += Number(b.stake ?? 0);
      map[k].net += normalizedProfit(b);
    }

    return Object.entries(map)
      .map(([sport, v]) => ({
        sport,
        label: sport === "Unknown" ? "Unknown / not saved" : titleCase(sport),
        total: v.total,
        winRate: v.total ? v.wins / v.total : 0,
        avgStake: v.total ? v.stakeSum / v.total : 0,
        net: v.net,
        roi: v.stakeSum > 0 ? v.net / v.stakeSum : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [settledWithResult, normalizedProfit]);

  const confidenceRows = useMemo(() => {
    const map: Record<
      string,
      { total: number; wins: number; losses: number; pushes: number; net: number; stakeSum: number }
    > = {};

    const keyFor = (c?: number | null) => {
      const n = Number(c);
      if (!Number.isFinite(n) || n <= 0) return "Unknown";
      const clamped = Math.max(1, Math.min(5, Math.round(n)));
      return String(clamped);
    };

    for (const b of settledWithResult) {
      const k = keyFor(b.confidence);
      map[k] = map[k] ?? { total: 0, wins: 0, losses: 0, pushes: 0, net: 0, stakeSum: 0 };

      map[k].total += 1;
      map[k].wins += b.result === "win" ? 1 : 0;
      map[k].losses += b.result === "loss" ? 1 : 0;
      map[k].pushes += b.result === "push" ? 1 : 0;

      map[k].stakeSum += Number(b.stake ?? 0);
      map[k].net += normalizedProfit(b);
    }

    const labelFor = (k: string) => {
      if (k === "Unknown") return "Unknown / not saved";
      const n = Number(k);
      return `${k} / 5 (${confidenceLabel(n)})`;
    };

    const sortKey = (k: string) => (k === "Unknown" ? -999 : Number(k));

    return Object.entries(map)
      .map(([k, v]) => ({
        key: k,
        label: labelFor(k),
        total: v.total,
        winRate: v.total ? v.wins / v.total : 0,
        avgStake: v.total ? v.stakeSum / v.total : 0,
        net: v.net,
        roi: v.stakeSum > 0 ? v.net / v.stakeSum : 0,
        wins: v.wins,
        losses: v.losses,
        pushes: v.pushes,
      }))
      .sort((a, b) => sortKey(b.key) - sortKey(a.key));
  }, [settledWithResult, normalizedProfit]);

  const topEmotionLabel = useMemo(() => {
    const k = overall.topEmotion;
    if (!k) return null;
    return EMOTION_LABEL_BY_VALUE[k] ?? k;
  }, [overall.topEmotion]);

  const hasSettled = overall.total > 0;

  const RangePills = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
      {RANGE_OPTIONS.map((opt) => {
        const active = opt.key === range;
        return (
          <Pressable
            key={opt.key}
            onPress={() => setRange(opt.key)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? Theme.text : Theme.border,
              backgroundColor: active ? Theme.text : Theme.card,
            }}
          >
            <Text
              style={{
                color: active ? Theme.bg : Theme.text,
                fontWeight: "900",
                fontSize: 12,
                letterSpacing: 0.3,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg, justifyContent: "center", padding: 16 }}>
        <Text style={{ color: Theme.sub, fontWeight: "700" }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const compareLine =
    deltas.canCompare && hasSettled
      ? `vs previous ${daysForRange(range)} days: Net ${
          (deltas.netDeltaPct ?? 0) >= 0 ? "↑" : "↓"
        } ${pct(Math.abs(deltas.netDeltaPct ?? 0))} • Win ${
          (deltas.winDeltaPts ?? 0) >= 0 ? "↑" : "↓"
        } ${Math.round(Math.abs((deltas.winDeltaPts ?? 0) * 100))} pts`
      : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={{ color: Theme.text, fontSize: 26, fontWeight: "900" }}>Insights</Text>

        <Text style={{ color: Theme.sub, fontWeight: "800", marginTop: -6 }}>
          {rangeLabel(range)}
        </Text>

        {RangePills}

        {compareLine ? (
          <View
            style={{
              marginTop: 6,
              padding: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: Theme.border,
              backgroundColor: Theme.card,
            }}
          >
            <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>{compareLine}</Text>
          </View>
        ) : null}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          <StatCard
            label="Win rate"
            value={hasSettled ? pct(overall.winRate) : "—"}
            sub={
              hasSettled
                ? `${overall.wins}W–${overall.losses}L${overall.pushes ? `–${overall.pushes}P` : ""}`
                : "No settled bets yet"
            }
          />
          <StatCard
            label="Net profit"
            value={hasSettled ? fmtMoney(overall.net) : "—"}
            sub={hasSettled ? `ROI ${pct(overall.roi)}` : "Settle bets to see ROI"}
          />
          <StatCard
            label="Avg stake"
            value={hasSettled ? fmtMoney(overall.avgStake) : "—"}
            sub={`${overall.openCount} open • ${overall.totalCount} total`}
          />
          <StatCard label="Most common vibe" value={topEmotionLabel ?? "—"} sub="Across logged bets" />
        </View>

        <Section title="Performance">
          {hasSettled ? (
            <>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>Win rate</Text>
              <Bar value={overall.winRate} labelLeft={`${overall.wins} wins`} labelRight={`${overall.losses} losses`} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                  Settled: <Text style={{ color: Theme.text, fontWeight: "900" }}>{overall.total}</Text>
                </Text>
                <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                  Total staked:{" "}
                  <Text style={{ color: Theme.text, fontWeight: "900" }}>
                    {fmtMoney(overall.totalStakedSettled)}
                  </Text>
                </Text>
              </View>
            </>
          ) : (
            <Text style={{ color: Theme.sub, fontWeight: "700" }}>
              Settle a few bets and this section will come alive.
            </Text>
          )}
        </Section>

        <Section title="Results by confidence">
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>
            How you perform at each confidence level (settled bets)
          </Text>

          {!hasSettled ? (
            <Text style={{ color: Theme.sub, fontWeight: "700" }}>No settled bets yet.</Text>
          ) : confidenceRows.length === 0 ? (
            <Text style={{ color: Theme.sub, fontWeight: "700" }}>No settled bets with confidence saved yet.</Text>
          ) : (
            <View style={{ gap: 12 }}>
              {confidenceRows.map((r) => (
                <View
                  key={r.key}
                  style={{
                    paddingTop: 10,
                    borderTopWidth: 1,
                    borderTopColor: Theme.border,
                    gap: 8,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: Theme.text, fontWeight: "900" }}>{r.label}</Text>
                    <Text style={{ color: Theme.sub, fontWeight: "800" }}>n={r.total}</Text>
                  </View>

                  <Bar
                    value={r.winRate}
                    labelLeft={`Win ${pct(r.winRate)} (${r.wins}W${r.losses ? `–${r.losses}L` : ""}${
                      r.pushes ? `–${r.pushes}P` : ""
                    })`}
                    labelRight={`Avg ${fmtMoney(r.avgStake)}`}
                  />

                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                      Net: <Text style={{ color: Theme.text, fontWeight: "900" }}>{fmtMoney(r.net)}</Text>
                    </Text>
                    <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                      ROI: <Text style={{ color: Theme.text, fontWeight: "900" }}>{pct(r.roi)}</Text>
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Section>

        <Section title="Risk mix">
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>
            Based on your selected emotions (if you pick any controlled vibe, it counts as 🟢 unless a 🔴 is present)
          </Text>

          <View style={{ gap: 10 }}>
            <View style={{ gap: 6 }}>
              <Text style={{ color: Theme.text, fontWeight: "900" }}>🔴 High-risk vibes: {pct(riskMix.highPct)}</Text>
              <Bar value={riskMix.highPct} />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={{ color: Theme.text, fontWeight: "900" }}>🟡 Neutral/mixed: {pct(riskMix.midPct)}</Text>
              <Bar value={riskMix.midPct} />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={{ color: Theme.text, fontWeight: "900" }}>🟢 Controlled: {pct(riskMix.lowPct)}</Text>
              <Bar value={riskMix.lowPct} />
            </View>
          </View>
        </Section>

        <Section title="By bet type (top)">
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>
            How different bet types perform (settled bets)
          </Text>
          {betTypeRows.length === 0 ? (
            <Text style={{ color: Theme.sub, fontWeight: "700" }}>No settled bets yet.</Text>
          ) : (
            <View style={{ gap: 12 }}>
              {betTypeRows.map((r) => (
                <View
                  key={r.betType}
                  style={{
                    paddingTop: 10,
                    borderTopWidth: 1,
                    borderTopColor: Theme.border,
                    gap: 8,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: Theme.text, fontWeight: "900" }}>{r.label}</Text>
                    <Text style={{ color: Theme.sub, fontWeight: "800" }}>n={r.total}</Text>
                  </View>

                  <Bar value={r.winRate} labelLeft={`Win ${pct(r.winRate)}`} labelRight={`Avg ${fmtMoney(r.avgStake)}`} />

                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                      Net: <Text style={{ color: Theme.text, fontWeight: "900" }}>{fmtMoney(r.net)}</Text>
                    </Text>
                    <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                      ROI: <Text style={{ color: Theme.text, fontWeight: "900" }}>{pct(r.roi)}</Text>
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Section>

        <Section title="By sport (top)">
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>
            How you perform across sports (settled bets)
          </Text>
          {sportRows.length === 0 ? (
            <Text style={{ color: Theme.sub, fontWeight: "700" }}>No settled bets yet.</Text>
          ) : (
            <View style={{ gap: 12 }}>
              {sportRows.map((r) => (
                <View
                  key={r.sport}
                  style={{
                    paddingTop: 10,
                    borderTopWidth: 1,
                    borderTopColor: Theme.border,
                    gap: 8,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: Theme.text, fontWeight: "900" }}>{r.label}</Text>
                    <Text style={{ color: Theme.sub, fontWeight: "800" }}>n={r.total}</Text>
                  </View>

                  <Bar value={r.winRate} labelLeft={`Win ${pct(r.winRate)}`} labelRight={`Avg ${fmtMoney(r.avgStake)}`} />

                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                      Net: <Text style={{ color: Theme.text, fontWeight: "900" }}>{fmtMoney(r.net)}</Text>
                    </Text>
                    <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                      ROI: <Text style={{ color: Theme.text, fontWeight: "900" }}>{pct(r.roi)}</Text>
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Section>

        <View style={{ height: 8 }} />
      </ScrollView>
    </SafeAreaView>
  );
}