// src/screens/InsightsScreen.tsx
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
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
  placed_at?: string | null;
};

function tidy(s?: string | null) {
  if (!s) return "";
  return String(s).replace(/\s+/g, " ").trim();
}

function insightTone(s: string) {
  const t = s.toLowerCase();
  if (t.includes("rough") || t.includes("down") || t.includes("elevated") || t.includes("warning"))
    return { icon: "⚠️", accent: Theme.warn };
  if (t.includes("strong") || t.includes("positive") || t.includes("paying off"))
    return { icon: "✅", accent: Theme.ok };
  return { icon: "👀", accent: Theme.sub };
}

function InsightCallout({ text }: { text: string }) {
  const tone = insightTone(text);
  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: Theme.border,
        backgroundColor: Theme.bg,
        padding: 12,
        flexDirection: "row",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      {/* left accent */}
      <View
        style={{
          width: 4,
          alignSelf: "stretch",
          borderRadius: 999,
          backgroundColor: tone.accent,
          opacity: 0.9,
        }}
      />
      <Text style={{ fontSize: 16, lineHeight: 20 }}>
        <Text style={{ color: Theme.text, fontWeight: "900" }}>
          {tone.icon} {text}
        </Text>
      </Text>
    </View>
  );
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

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function pct(n: number, digits = 0) {
  if (!Number.isFinite(n)) return "0%";
  const v = n * 100;
  if (digits <= 0) return `${Math.round(v)}%`;
  return `${v.toFixed(digits)}%`;
}

/** ✅ Currency formatting */
const USD0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const USD2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function fmtMoney(n: number, decimals: 0 | 2 = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "$0";
  return decimals === 2 ? USD2.format(x) : USD0.format(x);
}

/** ✅ Confidence labels */
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

function median(nums: number[]) {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  if (a.length % 2 === 1) return a[mid];
  return (a[mid - 1] + a[mid]) / 2;
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

/** ✅ Analytics date */
function betDateIso(b: Bet) {
  return b.placed_at ?? b.created_at ?? null;
}

/** ===================== RISK SCORING (Option A: MAX) ===================== */
const EMOTION_RISK_SCORE: Record<string, number> = {
  confident: 0,
  research: 0,
  system: 0,
  pre_planned: 0,

  fun: 1,
  social: 1,
  habit: 1,

  bored: 2,
  fomo: 2,
  impulsive: 2,
  stressed: 2,
  drinking: 2,

  chasing_losses: 3,
  tilted: 3,
  revenge: 3,
  doubling_down: 3,
  desperate: 3,
};

type RiskLevel = "low" | "mid" | "high" | "unknown";

function riskScoreForBet(emotions?: string[] | null, emotion?: string | null) {
  const list = emotions?.length ? emotions : emotion ? [emotion] : [];
  const cleaned = list.map((x) => tidy(x)).filter(Boolean);

  if (!cleaned.length) return { score: 0, hasEmotion: false };

  let max = 0;
  for (const key of cleaned) {
    const s = EMOTION_RISK_SCORE[key] ?? 0;
    if (s > max) max = s;
  }
  return { score: max, hasEmotion: true };
}

function riskLevelFromScore(score: number, hasEmotion: boolean): RiskLevel {
  if (!hasEmotion) return "unknown";
  if (score >= 3) return "high";
  if (score >= 2) return "mid";
  return "low";
}

/** ===================== UI ===================== */
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
          <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>{labelLeft ?? ""}</Text>
          <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>{labelRight ?? ""}</Text>
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

function Card({
  title,
  children,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        backgroundColor: Theme.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: Theme.border,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18 }}>{title}</Text>
          {subtitle ? (
            <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12, lineHeight: 16 }}>{subtitle}</Text>
          ) : null}
        </View>
        {right ? <View style={{ marginTop: 2 }}>{right}</View> : null}
      </View>
      {children}
    </View>
  );
}

function PillRow({ range, setRange }: { range: RangeKey; setRange: (k: RangeKey) => void }) {
  return (
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
}

function DeltaPill({ text }: { text: string }) {
  return (
    <View
      style={{
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: Theme.border,
        backgroundColor: Theme.card,
      }}
    >
      <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>{text}</Text>
    </View>
  );
}

function StatTile({
  title,
  value,
  sub,
  emoji,
}: {
  title: string;
  value: string;
  sub?: string;
  emoji?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: Theme.border,
        padding: 12,
        backgroundColor: Theme.bg,
        gap: 6,
        minWidth: 120,
      }}
    >
      <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>
        {emoji ? `${emoji} ` : ""}
        {title}
      </Text>
      <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18 }}>{value}</Text>
      {sub ? <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>{sub}</Text> : null}
    </View>
  );
}

function TinyPill({ text }: { text: string }) {
  return (
    <View
      style={{
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: Theme.border,
        backgroundColor: Theme.bg,
      }}
    >
      <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>{text}</Text>
    </View>
  );
}

function SectionToggle({
  open,
  onPress,
  label,
  hint,
}: {
  open: boolean;
  onPress: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        marginTop: 6,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: Theme.border,
        backgroundColor: Theme.bg,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: Theme.text, fontWeight: "900" }}>{label}</Text>
        {hint ? <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>{hint}</Text> : null}
      </View>
      <Text style={{ color: Theme.sub, fontWeight: "900" }}>{open ? "▲" : "▼"}</Text>
    </Pressable>
  );
}

/** ✅ Accurate Donut using react-native-svg (Expo includes this by default) */
function DonutRing({ highPct, midPct, lowPct }: { highPct: number; midPct: number; lowPct: number }) {
  const size = 132;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;

  const total = Math.max(0, highPct) + Math.max(0, midPct) + Math.max(0, lowPct);
  const h = total > 0 ? clamp01(highPct / total) : 0;
  const m = total > 0 ? clamp01(midPct / total) : 0;
  const l = total > 0 ? clamp01(lowPct / total) : 0;

  const hLen = C * h;
  const mLen = C * m;
  const lLen = C * l;

  const levels: { key: Exclude<RiskLevel, "unknown">; pct: number; label: string }[] = [
    { key: "low", pct: l, label: "Low" },
    { key: "mid", pct: m, label: "Mid" },
    { key: "high", pct: h, label: "High" },
  ];
  const top = [...levels].sort((a, b) => b.pct - a.pct)[0];
  const centerLine = total === 0 ? "No bets" : `${top.label} ${pct(top.pct)}`;

  const segs = [
    { color: "#ff3b30", len: hLen }, // high
    { color: "#ffcc00", len: mLen }, // mid
    { color: "#34c759", len: lLen }, // low
  ].filter((s) => s.len > 0.0001);

  let offset = 0;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size}>
        <G rotation={-90} originX={cx} originY={cy}>
          <Circle cx={cx} cy={cy} r={r} stroke="#2A3040" strokeWidth={stroke} fill="none" />
          {segs.map((s, i) => {
            const dash = `${s.len} ${C - s.len}`;
            const dashOffset = -offset;
            offset += s.len;
            return (
              <Circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                stroke={s.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={dash}
                strokeDashoffset={dashOffset}
                opacity={0.95}
              />
            );
          })}
        </G>
      </Svg>

      <View
        style={{
          position: "absolute",
          width: size - stroke * 2,
          height: size - stroke * 2,
          borderRadius: (size - stroke * 2) / 2,
          backgroundColor: Theme.card,
          borderWidth: 1,
          borderColor: Theme.border,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 10,
        }}
      >
        <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18 }}>Risk</Text>
        <Text numberOfLines={1} style={{ color: Theme.sub, fontWeight: "900", fontSize: 14 }}>
          {centerLine}
        </Text>
      </View>
    </View>
  );
}

function StarsRow({ k }: { k: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(k)));
  return (
    <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          style={{
            width: i === 1 || i === 5 ? 18 : 16,
            height: 10,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: Theme.border,
            backgroundColor: i <= filled ? Theme.text : Theme.bg,
            opacity: i <= filled ? 0.95 : 1,
          }}
        />
      ))}
      <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12, marginLeft: 6 }}>
        {filled}/5 • {confidenceLabel(filled)}
      </Text>
    </View>
  );
}

/** ===================== Screen ===================== */
export default function InsightsScreen() {
  const revision = useAppStore((s) => s.revision);

  const [range, setRange] = useState<RangeKey>("30d");
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  const [prevNet, setPrevNet] = useState<number | null>(null);
  const [prevWinRate, setPrevWinRate] = useState<number | null>(null);
  const [prevHasSettled, setPrevHasSettled] = useState(false);

  // existing details (bet type / sport)
  const [openDetails, setOpenDetails] = useState(false);
  const [openBetType, setOpenBetType] = useState(false);
  const [openSport, setOpenSport] = useState(false);

  // collapsible breakdowns inside the core cards
  const [openRiskBreakdown, setOpenRiskBreakdown] = useState(false);
  const [openConfidenceBreakdown, setOpenConfidenceBreakdown] = useState(false);

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
      const settledRows = rows.filter((b) => b.status === "settled" && b.result !== null);
      const wins = settledRows.filter((b) => b.result === "win").length;
      const losses = settledRows.filter((b) => b.result === "loss").length;
      const total = settledRows.length;
      const winRate = total ? wins / total : 0;
      const net = settledRows.reduce((sum, b) => sum + normalizedProfit(b), 0);
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

      const q = supabase
        .from("bets")
        .select("stake,emotion,emotions,confidence,sport,bet_type,status,result,profit,settled_at,created_at,placed_at")
        .eq("user_id", user.id)
        .order("placed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      const { data, error } = await q;
      if (error) throw error;

      const allRows = (((data as any) ?? []) as Bet[]) ?? [];

      const rows = start
        ? allRows.filter((b) => {
            const dIso = betDateIso(b);
            if (!dIso) return false;
            const d = new Date(dIso);
            return Number.isFinite(d.getTime()) && d >= start;
          })
        : allRows;

      setBets(rows);

      const days = daysForRange(range);
      if (!days || !start) {
        setPrevNet(null);
        setPrevWinRate(null);
        setPrevHasSettled(false);
      } else {
        const prevEnd = new Date(start);
        const prevStart = new Date(start);
        prevStart.setDate(prevStart.getDate() - days);

        const prevRows = allRows.filter((b) => {
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

  const settled = useMemo(() => bets.filter((b) => b.status === "settled" && b.result !== null), [bets]);

  const overall = useMemo(() => {
    const wins = settled.filter((b) => b.result === "win").length;
    const losses = settled.filter((b) => b.result === "loss").length;
    const pushes = settled.filter((b) => b.result === "push").length;

    const total = settled.length;
    const winRate = total ? wins / total : 0;

    const totalStakedSettled = settled.reduce((sum, b) => sum + Number(b.stake ?? 0), 0);
    const net = settled.reduce((sum, b) => sum + normalizedProfit(b), 0);
    const roi = totalStakedSettled > 0 ? net / totalStakedSettled : 0;

    return { wins, losses, pushes, total, winRate, net, roi, totalStakedSettled };
  }, [settled, normalizedProfit]);

  const deltas = useMemo(() => {
    const canCompare = prevNet !== null && prevWinRate !== null && prevHasSettled && overall.total > 0;
    if (!canCompare)
      return {
        canCompare: false as const,
        netDeltaPct: null as number | null,
        winDeltaPts: null as number | null,
      };

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
  }, [overall.net, overall.winRate, overall.total, prevNet, prevWinRate, prevHasSettled]);

  const compareLine = useMemo(() => {
    if (!deltas.canCompare) return null;
    const days = daysForRange(range);
    if (!days) return null;

    const netArrow = (deltas.netDeltaPct ?? 0) >= 0 ? "↑" : "↓";
    const winArrow = (deltas.winDeltaPts ?? 0) >= 0 ? "↑" : "↓";

    return `vs previous ${days} days: Net ${netArrow} ${pct(Math.abs(deltas.netDeltaPct ?? 0))} • Win ${winArrow} ${Math.round(
      Math.abs((deltas.winDeltaPts ?? 0) * 100)
    )} pts`;
  }, [deltas, range]);

  /** ===== Risk profile + performance ===== */
  const risk = useMemo(() => {
    let low = 0;
    let mid = 0;
    let high = 0;
    let unknown = 0;

    // only track perf for classified buckets (low/mid/high)
    const perf: Record<Exclude<RiskLevel, "unknown">, { n: number; wins: number; stakeSum: number; net: number }> = {
      low: { n: 0, wins: 0, stakeSum: 0, net: 0 },
      mid: { n: 0, wins: 0, stakeSum: 0, net: 0 },
      high: { n: 0, wins: 0, stakeSum: 0, net: 0 },
    };

    for (const b of bets) {
      const { score, hasEmotion } = riskScoreForBet(b.emotions ?? null, b.emotion ?? null);
      const lvl = riskLevelFromScore(score, hasEmotion);

      if (lvl === "low") low += 1;
      else if (lvl === "mid") mid += 1;
      else if (lvl === "high") high += 1;
      else unknown += 1;

      if (lvl !== "unknown" && b.status === "settled" && b.result !== null) {
        perf[lvl].n += 1;
        perf[lvl].wins += b.result === "win" ? 1 : 0;
        perf[lvl].stakeSum += Number(b.stake ?? 0);
        perf[lvl].net += normalizedProfit(b);
      }
    }

    // donut/mix should reflect only classified bets, not missing emotions
    const classifiedTotal = low + mid + high;
    const denom = classifiedTotal || 1;

    const lowPct = low / denom;
    const midPct = mid / denom;
    const highPct = high / denom;

    // unknown shown separately (out of all bets)
    const unknownPct = bets.length ? unknown / bets.length : 0;

    let profileLine = "Log emotions to build your risk profile.";
    if (classifiedTotal >= 5) {
      profileLine = "Mostly strategic betting.";
      if (highPct >= 0.35) profileLine = "High-risk betting is elevated.";
      else if (midPct >= 0.35) profileLine = "You’re mixing in a lot of situational bets.";
      else if (lowPct >= 0.75) profileLine = "You’re keeping risk low — solid discipline.";
    }
    if (unknownPct >= 0.35) {
      profileLine = "Risk profile is incomplete — many bets have no emotions logged.";
    }

    const toRow = (level: Exclude<RiskLevel, "unknown">) => {
      const p = perf[level];
      const winRate = p.n ? p.wins / p.n : 0;
      const roi = p.stakeSum > 0 ? p.net / p.stakeSum : 0;
      const avgStake = p.n ? p.stakeSum / p.n : 0;
      return { level, ...p, winRate, roi, avgStake };
    };

    const rows = [toRow("high"), toRow("mid"), toRow("low")];

    const bestByNet = [...rows].sort((a, b) => b.net - a.net)[0];
    const worstByNet = [...rows].sort((a, b) => a.net - b.net)[0];

    const name = (lvl: Exclude<RiskLevel, "unknown">) => (lvl === "high" ? "high-risk" : lvl === "mid" ? "mid-risk" : "low-risk");

    let perfSummary = "Settle bets to see how risk level performs.";
    const totalSettledByRisk = rows.reduce((s, r) => s + r.n, 0);

    if (totalSettledByRisk > 0) {
      const bucketsWithData = rows.filter((r) => r.n > 0);
      if (bucketsWithData.length === 1) {
        const r = bucketsWithData[0];
        perfSummary = `So far, all settled bets are ${name(r.level)}: ${pct(r.winRate)} win rate and ${fmtMoney(r.net, 0)} net.`;
      } else {
        perfSummary = `Best so far: ${name(bestByNet.level)} (${pct(bestByNet.winRate)} win, ${fmtMoney(
          bestByNet.net,
          0
        )} net). Weakest: ${name(worstByNet.level)} (${pct(worstByNet.winRate)} win, ${fmtMoney(worstByNet.net, 0)} net).`;
      }
    }

    return {
      mix: { low, mid, high, unknown, lowPct, midPct, highPct, unknownPct, classifiedTotal },
      profileLine,
      perfRows: rows,
      perfSummary,
      totalSettledByRisk,
    };
  }, [bets, normalizedProfit]);

  /** ===== Confidence (revamped: insight-led + discipline + action) ===== */
  const confidenceImpact = useMemo(() => {
    type Agg = { n: number; wins: number; stakeSum: number; net: number };

    const byK: Record<number, Agg> = {};
    const add = (k: number, b: Bet) => {
      byK[k] = byK[k] ?? { n: 0, wins: 0, stakeSum: 0, net: 0 };
      byK[k].n += 1;
      byK[k].wins += b.result === "win" ? 1 : 0;
      byK[k].stakeSum += Number(b.stake ?? 0);
      byK[k].net += normalizedProfit(b);
    };

    const confs: number[] = [];

    for (const b of settled) {
      const raw = Number(b.confidence ?? 0);
      if (!Number.isFinite(raw) || raw <= 0) continue;
      const k = Math.max(1, Math.min(5, Math.round(raw)));
      confs.push(k);
      add(k, b);
    }

    const rowFor = (k: number) => {
      const a = byK[k] ?? { n: 0, wins: 0, stakeSum: 0, net: 0 };
      const winRate = a.n ? a.wins / a.n : 0;
      const roi = a.stakeSum > 0 ? a.net / a.stakeSum : 0;
      return { k, ...a, winRate, roi, label: `${k}/5 (${confidenceLabel(k)})` };
    };

    const rowsAll = [5, 4, 3, 2, 1].map(rowFor);
    const rowsWithData = rowsAll.filter((r) => r.n > 0);

    const groupAgg = (ks: number[]) => {
      const g: Agg = { n: 0, wins: 0, stakeSum: 0, net: 0 };
      for (const k of ks) {
        const a = byK[k];
        if (!a) continue;
        g.n += a.n;
        g.wins += a.wins;
        g.stakeSum += a.stakeSum;
        g.net += a.net;
      }
      const winRate = g.n ? g.wins / g.n : 0;
      const roi = g.stakeSum > 0 ? g.net / g.stakeSum : 0;
      return { ...g, winRate, roi };
    };

    const hi = groupAgg([4, 5]);
    const lo = groupAgg([1, 2]);

    const nConf = confs.length;
    const avgConf = nConf ? confs.reduce((s, x) => s + x, 0) / nConf : null;
    const medConf = nConf ? median(confs) : null;
    const pctHigh = nConf ? confs.filter((x) => x >= 4).length / nConf : 0;
    const pctLow = nConf ? confs.filter((x) => x <= 2).length / nConf : 0;

    // Discipline label
    let disciplineLabel = "Building";
    let disciplineEmoji = "🟡";
    let disciplineHint = "Log more confidence to sharpen your edge.";
    if (nConf >= 8) {
      if (pctHigh >= 0.6 && pctLow <= 0.2) {
        disciplineLabel = "Strong discipline";
        disciplineEmoji = "🟢";
        disciplineHint = "You mostly bet when conviction is high.";
      } else if (pctLow >= 0.35) {
        disciplineLabel = "Impulse pattern";
        disciplineEmoji = "🔴";
        disciplineHint = "A lot of bets are low-conviction.";
      } else {
        disciplineLabel = "Mixed discipline";
        disciplineEmoji = "🟡";
        disciplineHint = "You mix high-conviction with some low-conviction bets.";
      }
    }

    const winDiffPts = (hi.winRate - lo.winRate) * 100;

    let headline = "Add confidence on bets to unlock your edge.";
    let story = "Track confidence (1–5) to see what wins and what bleeds.";

    const enoughHiLo = hi.n >= 5 && lo.n >= 5;
    if (enoughHiLo) {
      headline =
        winDiffPts >= 25
          ? `You win ${Math.round(winDiffPts)} pts more when confident (4–5).`
          : winDiffPts <= -10
          ? `Surprise: low-confidence (1–2) is beating high-confidence.`
          : `High confidence is trending better than low confidence.`;

      story = `High (4–5): ${pct(hi.winRate)} win • ROI ${pct(hi.roi)} • Net ${fmtMoney(
        hi.net,
        0
      )}. Low (1–2): ${pct(lo.winRate)} win • ROI ${pct(lo.roi)} • Net ${fmtMoney(lo.net, 0)}.`;
    } else if (hi.n >= 3) {
      headline = `High confidence (4–5) is ${pct(hi.winRate)} win so far.`;
      story = `Keep logging confidence — you need a few more bets for a reliable signal.`;
    } else if (nConf > 0) {
      headline = `You’ve logged confidence on ${nConf} settled bet${nConf === 1 ? "" : "s"}.`;
      story = `Log a few more to get a real read on your edge by conviction.`;
    }

    const suggestions: string[] = [];
    if (nConf < 5) {
      suggestions.push("Log confidence on every bet for a week — patterns show up fast.");
    } else {
      if (lo.n >= 3 && lo.roi < 0) suggestions.push("Consider skipping bets at 1–2 confidence.");
      if (hi.n >= 3 && hi.roi > 0) suggestions.push("When confidence is 4–5, your results look stronger — lean selective.");
      if (pctLow >= 0.35) suggestions.push("Try a rule: no bet below 3 unless it’s pre-planned.");
    }
    if (!suggestions.length) suggestions.push("Keep going — more settled bets will make this insight sharper.");

    const bestExact =
      rowsWithData.length > 0
        ? [...rowsWithData].sort((a, b) => (b.n >= 3 ? b.roi : -999) - (a.n >= 3 ? a.roi : -999))[0]?.k ?? null
        : null;

    return {
      rowsAll,
      rowsWithData,
      hi,
      lo,
      headline,
      story,
      nConf,
      avgConf,
      medConf,
      pctHigh,
      pctLow,
      disciplineEmoji,
      disciplineLabel,
      disciplineHint,
      suggestions,
      bestExact,
    };
  }, [settled, normalizedProfit]);

  const betTypeRows = useMemo(() => {
    const map: Record<string, { n: number; wins: number; net: number }> = {};
    for (const b of settled) {
      const k = tidy(b.bet_type) || "Unknown";
      map[k] = map[k] ?? { n: 0, wins: 0, net: 0 };
      map[k].n += 1;
      map[k].wins += b.result === "win" ? 1 : 0;
      map[k].net += normalizedProfit(b);
    }
    return Object.entries(map)
      .map(([k, v]) => ({
        key: k,
        label: k === "Unknown" ? "Unknown / not saved" : titleCase(k),
        n: v.n,
        winRate: v.n ? v.wins / v.n : 0,
        net: v.net,
      }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8);
  }, [settled, normalizedProfit]);

  const sportRows = useMemo(() => {
    const map: Record<string, { n: number; wins: number; net: number }> = {};
    for (const b of settled) {
      const k = tidy(b.sport) || "Unknown";
      map[k] = map[k] ?? { n: 0, wins: 0, net: 0 };
      map[k].n += 1;
      map[k].wins += b.result === "win" ? 1 : 0;
      map[k].net += normalizedProfit(b);
    }
    return Object.entries(map)
      .map(([k, v]) => ({
        key: k,
        label: k === "Unknown" ? "Unknown / not saved" : titleCase(k),
        n: v.n,
        winRate: v.n ? v.wins / v.n : 0,
        net: v.net,
      }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8);
  }, [settled, normalizedProfit]);

  const snapshotInsight = useMemo(() => {
    if (overall.total === 0) return "Settle a few bets and Insights will come alive.";
    if (risk.mix.highPct >= 0.35 && overall.net < 0) return "High-risk betting is elevated and results are down.";
    if (risk.mix.highPct >= 0.35 && overall.net >= 0) return "High-risk bets are elevated — and currently paying off.";
    if (risk.mix.lowPct >= 0.75 && overall.net >= 0) return "You’re keeping risk low and staying positive.";
    if (overall.winRate >= 0.6) return "Strong stretch — keep doing what’s working.";
    if (overall.winRate <= 0.35) return "Rough stretch — consider tightening confidence + risk.";
    return "Steady results — look at confidence and risk for patterns.";
  }, [overall.total, overall.net, overall.winRate, risk.mix.highPct, risk.mix.lowPct]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg, justifyContent: "center", padding: 16 }}>
        <Text style={{ color: Theme.sub, fontWeight: "700" }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const hasSettled = overall.total > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={{ color: Theme.text, fontSize: 26, fontWeight: "900" }}>Insights</Text>
        <Text style={{ color: Theme.sub, fontWeight: "800", marginTop: -6 }}>{rangeLabel(range)}</Text>
        <PillRow range={range} setRange={setRange} />
        {compareLine ? <DeltaPill text={compareLine} /> : null}

        {/* Snapshot */}
        <Card title="Snapshot">
  <InsightCallout text={snapshotInsight} />
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
              <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Net profit</Text>
              <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 12 }}>
                {hasSettled ? `${overall.total} settled` : "0 settled"}
              </Text>
            </View>

            <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 34, letterSpacing: -0.5 }}>
              {hasSettled ? fmtMoney(overall.net, 0) : "—"}
            </Text>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <StatTile
                title="Win rate"
                value={hasSettled ? pct(overall.winRate) : "—"}
                sub={
                  hasSettled
                    ? `${overall.wins}W–${overall.losses}L${overall.pushes ? `–${overall.pushes}P` : ""}`
                    : "No settled bets yet"
                }
              />
              <StatTile
                title="ROI"
                value={hasSettled ? pct(overall.roi) : "—"}
                sub={hasSettled ? `Staked ${fmtMoney(overall.totalStakedSettled, 0)}` : "Settle bets to see ROI"}
              />
            </View>
          </View>
        </Card>

        {/* Risk Profile */}
        <Card title="Your risk profile" subtitle="Built based on your emotional state at the time of logging your bets.">
          <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18, lineHeight: 22 }}>{risk.profileLine}</Text>

          {/* core: donut + mix */}
          <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
            <DonutRing highPct={risk.mix.highPct} midPct={risk.mix.midPct} lowPct={risk.mix.lowPct} />

            <View style={{ flex: 1, gap: 10 }}>
              <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>
                Bets by risk level{" "}
                {risk.mix.unknown ? (
                  <Text style={{ color: Theme.sub, fontWeight: "800" }}>(classified only)</Text>
                ) : null}
              </Text>

              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>🔴 High</Text>
                  <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>
                    {risk.mix.high} <Text style={{ color: Theme.sub, fontWeight: "900" }}>({pct(risk.mix.highPct)})</Text>
                  </Text>
                </View>

                <View style={{ height: 1, backgroundColor: Theme.border, opacity: 0.8 }} />

                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>🟡 Mid</Text>
                  <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>
                    {risk.mix.mid} <Text style={{ color: Theme.sub, fontWeight: "900" }}>({pct(risk.mix.midPct)})</Text>
                  </Text>
                </View>

                <View style={{ height: 1, backgroundColor: Theme.border, opacity: 0.8 }} />

                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>🟢 Low</Text>
                  <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>
                    {risk.mix.low} <Text style={{ color: Theme.sub, fontWeight: "900" }}>({pct(risk.mix.lowPct)})</Text>
                  </Text>
                </View>

                {risk.mix.unknown ? (
                  <>
                    <View style={{ height: 1, backgroundColor: Theme.border, opacity: 0.8 }} />
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>⚪️ Unknown</Text>
                      <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>
                        {risk.mix.unknown}{" "}
                        <Text style={{ color: Theme.sub, fontWeight: "900" }}>({pct(risk.mix.unknownPct)})</Text>
                      </Text>
                    </View>
                    <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12, marginTop: -2, lineHeight: 16 }}>
                      Unknown = bets where no emotions were logged
                    </Text>
                  </>
                ) : null}
              </View>
            </View>
          </View>

          {/* core: summary line always visible */}
          <View style={{ marginTop: 10, gap: 8 }}>
            <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18 }}>Performance by risk level</Text>
            <Text style={{ color: Theme.sub, fontWeight: "800", lineHeight: 18 }}>{risk.perfSummary}</Text>

            <SectionToggle
              open={openRiskBreakdown}
              onPress={() => setOpenRiskBreakdown((v) => !v)}
              label={openRiskBreakdown ? "Hide breakdown" : "Show breakdown"}
              hint={!hasSettled ? "Settle bets to populate the breakdown." : `Shows win rate, ROI, and net by risk bucket.`}
            />

            {openRiskBreakdown ? (
              !hasSettled ? (
                <Text style={{ color: Theme.sub, fontWeight: "800" }}>No settled bets yet.</Text>
              ) : (
                <View style={{ gap: 14, marginTop: 6 }}>
                  {risk.perfRows.map((r) => {
                    const label = r.level === "high" ? "🔴 High risk" : r.level === "mid" ? "🟡 Mid risk" : "🟢 Low risk";
                    return (
                      <View key={r.level} style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: Theme.border }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          <Text style={{ color: Theme.text, fontWeight: "900" }}>{label}</Text>
                          <Text style={{ color: Theme.sub, fontWeight: "900" }}>n={r.n}</Text>
                        </View>
                        <Bar
                          value={r.winRate}
                          labelLeft={`Win ${pct(r.winRate)} (${r.wins}W)`}
                          labelRight={`Avg ${r.n ? fmtMoney(r.avgStake, 0) : "$0"}`}
                        />
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                            Net: <Text style={{ color: Theme.text, fontWeight: "900" }}>{fmtMoney(r.net, 0)}</Text>
                          </Text>
                          <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                            ROI: <Text style={{ color: Theme.text, fontWeight: "900" }}>{pct(r.roi)}</Text>
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )
            ) : null}
          </View>
        </Card>

        {/* Confidence edge */}
        <Card title="Confidence edge" subtitle="Your conviction level is one of your strongest discipline signals.">
          {!hasSettled ? (
            <Text style={{ color: Theme.sub, fontWeight: "800" }}>No settled bets yet.</Text>
          ) : confidenceImpact.nConf === 0 ? (
            <View style={{ gap: 10 }}>
              <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18, lineHeight: 22 }}>
                Add confidence to unlock your edge.
              </Text>
              <Text style={{ color: Theme.sub, fontWeight: "800", lineHeight: 18 }}>
                Start logging confidence (1–5) when you place a bet. This section will show exactly what “you know ball” looks like in your
                results.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <View
                style={{
                  backgroundColor: Theme.bg,
                  borderWidth: 1,
                  borderColor: Theme.border,
                  borderRadius: 16,
                  padding: 12,
                  gap: 10,
                }}
              >
                <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18, lineHeight: 22 }}>{confidenceImpact.headline}</Text>
                <Text style={{ color: Theme.sub, fontWeight: "800", lineHeight: 18 }}>{confidenceImpact.story}</Text>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <TinyPill text={`Logged: ${confidenceImpact.nConf} bet${confidenceImpact.nConf === 1 ? "" : "s"}`} />
                  <TinyPill text={`Avg: ${confidenceImpact.avgConf ? confidenceImpact.avgConf.toFixed(1) : "—"}/5`} />
                  <TinyPill text={`Median: ${confidenceImpact.medConf != null ? String(confidenceImpact.medConf) : "—"}/5`} />
                  <TinyPill text={`% ≥4: ${pct(confidenceImpact.pctHigh)}`} />
                  <TinyPill text={`% ≤2: ${pct(confidenceImpact.pctLow)}`} />
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 12 }}>
                <StatTile
                  title="High confidence (4–5)"
                  emoji="🔥"
                  value={confidenceImpact.hi.n ? `Win ${pct(confidenceImpact.hi.winRate)}` : "—"}
                  sub={
                    confidenceImpact.hi.n
                      ? `ROI ${pct(confidenceImpact.hi.roi)} • Net ${fmtMoney(confidenceImpact.hi.net, 0)} • n=${confidenceImpact.hi.n}`
                      : "Not enough data"
                  }
                />
                <StatTile
                  title="Low confidence (1–2)"
                  emoji="🧊"
                  value={confidenceImpact.lo.n ? `Win ${pct(confidenceImpact.lo.winRate)}` : "—"}
                  sub={
                    confidenceImpact.lo.n
                      ? `ROI ${pct(confidenceImpact.lo.roi)} • Net ${fmtMoney(confidenceImpact.lo.net, 0)} • n=${confidenceImpact.lo.n}`
                      : "Not enough data"
                  }
                />
              </View>

              <View
                style={{
                  backgroundColor: Theme.bg,
                  borderWidth: 1,
                  borderColor: Theme.border,
                  borderRadius: 16,
                  padding: 12,
                  gap: 8,
                }}
              >
                <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>DISCIPLINE</Text>
                <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18 }}>
                  {confidenceImpact.disciplineEmoji} {confidenceImpact.disciplineLabel}
                </Text>
                <Text style={{ color: Theme.sub, fontWeight: "800", lineHeight: 18 }}>{confidenceImpact.disciplineHint}</Text>
              </View>

              <View
                style={{
                  backgroundColor: Theme.bg,
                  borderWidth: 1,
                  borderColor: Theme.border,
                  borderRadius: 16,
                  padding: 12,
                  gap: 8,
                }}
              >
                <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>WHAT TO DO NEXT</Text>
                {confidenceImpact.suggestions.slice(0, 3).map((s, i) => (
                  <Text key={i} style={{ color: Theme.text, fontWeight: "800", lineHeight: 18 }}>
                    • {s}
                  </Text>
                ))}
              </View>

              <SectionToggle
                open={openConfidenceBreakdown}
                onPress={() => setOpenConfidenceBreakdown((v) => !v)}
                label={openConfidenceBreakdown ? "Hide exact confidence breakdown" : "Show exact confidence breakdown"}
                hint={openConfidenceBreakdown ? "Win rate + ROI + net for each confidence level." : "See 1/5 through 5/5 performance."}
              />

              {openConfidenceBreakdown ? (
                <View style={{ gap: 10, marginTop: 6 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                    <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>By exact confidence</Text>
                    <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>
                      best: {confidenceImpact.bestExact ? `${confidenceImpact.bestExact}/5` : "—"}
                    </Text>
                  </View>

                  {confidenceImpact.rowsAll.map((r) => {
                    const has = r.n > 0;
                    const highlighted = confidenceImpact.bestExact === r.k && r.n >= 3;
                    return (
                      <View
                        key={r.k}
                        style={{
                          gap: 8,
                          padding: 12,
                          borderRadius: 16,
                          borderWidth: 1,
                          borderColor: highlighted ? Theme.text : Theme.border,
                          backgroundColor: Theme.bg,
                        }}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <StarsRow k={r.k} />
                          <Text style={{ color: Theme.sub, fontWeight: "900" }}>{has ? `n=${r.n}` : "—"}</Text>
                        </View>

                        {has ? (
                          <>
                            <Bar value={r.winRate} labelLeft={`Win ${pct(r.winRate)}`} labelRight={`ROI ${pct(r.roi)}`} />
                            <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>
                              Net <Text style={{ color: Theme.text, fontWeight: "900" }}>{fmtMoney(r.net, 0)}</Text> • Staked{" "}
                              <Text style={{ color: Theme.text, fontWeight: "900" }}>{fmtMoney(r.stakeSum, 0)}</Text>
                            </Text>
                          </>
                        ) : (
                          <Text style={{ color: Theme.sub, fontWeight: "800" }}>Not enough data</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          )}
        </Card>

        {/* Details (kept collapsible) */}
        <View
          style={{
            backgroundColor: Theme.card,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: Theme.border,
            overflow: "hidden",
          }}
        >
          <Pressable
            onPress={() => setOpenDetails((v) => !v)}
            style={{
              padding: 14,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>Performance details</Text>
              <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>Tap to drill into bet type and sport.</Text>
            </View>
            <Text style={{ color: Theme.sub, fontWeight: "900" }}>{openDetails ? "▲" : "▼"}</Text>
          </Pressable>

          {openDetails ? (
            <View style={{ padding: 14, paddingTop: 6, borderTopWidth: 1, borderTopColor: Theme.border, gap: 12 }}>
              {/* By bet type */}
              <View
                style={{
                  backgroundColor: Theme.bg,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: Theme.border,
                  overflow: "hidden",
                }}
              >
                <Pressable
                  onPress={() => setOpenBetType((v) => !v)}
                  style={{ padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: Theme.text, fontWeight: "900" }}>By bet type</Text>
                    <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>
                      {confidenceImpact && betTypeRows.length
                        ? `Top: ${betTypeRows[0].label} • ${pct(betTypeRows[0].winRate)} • Net ${fmtMoney(betTypeRows[0].net, 0)}`
                        : "No settled bets yet."}
                    </Text>
                  </View>
                  <Text style={{ color: Theme.sub, fontWeight: "900" }}>{openBetType ? "▲" : "▼"}</Text>
                </Pressable>

                {openBetType ? (
                  <View style={{ padding: 12, paddingTop: 0, gap: 12 }}>
                    {betTypeRows.length === 0 ? (
                      <Text style={{ color: Theme.sub, fontWeight: "800" }}>No data yet.</Text>
                    ) : (
                      betTypeRows.map((r) => (
                        <View key={r.key} style={{ gap: 6 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                            <Text style={{ color: Theme.text, fontWeight: "900" }}>{r.label}</Text>
                            <Text style={{ color: Theme.sub, fontWeight: "900" }}>n={r.n}</Text>
                          </View>
                          <Bar value={r.winRate} labelLeft={`Win ${pct(r.winRate)}`} labelRight={`Net ${fmtMoney(r.net, 0)}`} />
                        </View>
                      ))
                    )}
                  </View>
                ) : null}
              </View>

              {/* By sport */}
              <View
                style={{
                  backgroundColor: Theme.bg,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: Theme.border,
                  overflow: "hidden",
                }}
              >
                <Pressable
                  onPress={() => setOpenSport((v) => !v)}
                  style={{ padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: Theme.text, fontWeight: "900" }}>By sport</Text>
                    <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>
                      {sportRows.length
                        ? `Top: ${sportRows[0].label} • ${pct(sportRows[0].winRate)} • Net ${fmtMoney(sportRows[0].net, 0)}`
                        : "No settled bets yet."}
                    </Text>
                  </View>
                  <Text style={{ color: Theme.sub, fontWeight: "900" }}>{openSport ? "▲" : "▼"}</Text>
                </Pressable>

                {openSport ? (
                  <View style={{ padding: 12, paddingTop: 0, gap: 12 }}>
                    {sportRows.length === 0 ? (
                      <Text style={{ color: Theme.sub, fontWeight: "800" }}>No data yet.</Text>
                    ) : (
                      sportRows.map((r) => (
                        <View key={r.key} style={{ gap: 6 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                            <Text style={{ color: Theme.text, fontWeight: "900" }}>{r.label}</Text>
                            <Text style={{ color: Theme.sub, fontWeight: "900" }}>n={r.n}</Text>
                          </View>
                          <Bar value={r.winRate} labelLeft={`Win ${pct(r.winRate)}`} labelRight={`Net ${fmtMoney(r.net, 0)}`} />
                        </View>
                      ))
                    )}
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>

        <View style={{ height: 8 }} />
      </ScrollView>
    </SafeAreaView>
  );
}