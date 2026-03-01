import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, SafeAreaView, ScrollView, Text, View } from "react-native";
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

export default function InsightsScreen() {
  const revision = useAppStore((s) => s.revision);
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      const user = userData.user;
      if (!user) {
        setBets([]);
        return;
      }

      const since = new Date();
      since.setDate(since.getDate() - 30);

      const { data, error } = await supabase
        .from("bets")
        .select(
          "stake,emotion,emotions,confidence,sport,bet_type,status,result,profit,settled_at,created_at"
        )
        .eq("user_id", user.id)
        .gte("created_at", iso(since))
        .order("created_at", { ascending: false });

      if (error) throw error;

      setBets((data as any) ?? []);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not load insights");
    } finally {
      setLoading(false);
    }
  }, []);

  // refresh on store revision change (keep)
  useEffect(() => {
    load();
  }, [revision, load]);

  // ✅ refresh whenever this tab/screen becomes active
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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

  const riskMix = useMemo(() => {
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

    type Level = "high" | "mid" | "low" | "unknown";

    const classify = (vals: string[]): Level => {
      let level: Level = "unknown";
      for (const raw of vals) {
        const e = tidy(raw);
        if (HIGH.has(e)) return "high";
        if (MID.has(e)) level = "mid";
        if (LOW.has(e) && level === "unknown") level = "low";
      }
      return level;
    };

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
      const level = classify(keys);

      if (level === "high") high += 1;
      else if (level === "mid") mid += 1;
      else if (level === "low") low += 1;
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
    const map: Record<
      string,
      { total: number; wins: number; net: number; stakeSum: number }
    > = {};

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
    const map: Record<
      string,
      { total: number; wins: number; net: number; stakeSum: number }
    > = {};

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

  // ✅ NEW: Results by confidence level (settled bets only)
  const confidenceRows = useMemo(() => {
    const map: Record<
      string,
      { total: number; wins: number; losses: number; pushes: number; net: number; stakeSum: number }
    > = {};

    const keyFor = (c?: number | null) => {
      const n = Number(c);
      if (!Number.isFinite(n) || n <= 0) return "Unknown";
      const clamped = Math.max(1, Math.min(5, Math.round(n)));
      return String(clamped); // "1".."5"
    };

    for (const b of settledWithResult) {
      const k = keyFor(b.confidence);
      map[k] =
        map[k] ?? { total: 0, wins: 0, losses: 0, pushes: 0, net: 0, stakeSum: 0 };

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
      // 1 = Low, 5 = High
      const tag = n <= 2 ? "Low" : n === 3 ? "Mid" : "High"; // 4–5 = High
      return `${k} / 5 (${tag})`;
    };

    // Order 5→1, Unknown last
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

  if (loading) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: Theme.bg,
          justifyContent: "center",
          padding: 16,
        }}
      >
        <Text style={{ color: Theme.sub, fontWeight: "700" }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={{ color: Theme.text, fontSize: 26, fontWeight: "900" }}>
          Insights
        </Text>
        <Text style={{ color: Theme.sub, fontWeight: "800", marginTop: -6 }}>
          Last 30 days
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          <StatCard
            label="Win rate"
            value={hasSettled ? pct(overall.winRate) : "—"}
            sub={
              hasSettled
                ? `${overall.wins}W–${overall.losses}L${
                    overall.pushes ? `–${overall.pushes}P` : ""
                  }`
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
          <StatCard
            label="Most common vibe"
            value={topEmotionLabel ?? "—"}
            sub="Across all logged bets"
          />
        </View>

        <Section title="Performance">
          {hasSettled ? (
            <>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>Win rate</Text>
              <Bar
                value={overall.winRate}
                labelLeft={`${overall.wins} wins`}
                labelRight={`${overall.losses} losses`}
              />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                  Settled:{" "}
                  <Text style={{ color: Theme.text, fontWeight: "900" }}>
                    {overall.total}
                  </Text>
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

        {/* ✅ NEW SECTION */}
        <Section title="Results by confidence">
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>
            How you perform at each confidence level (settled bets)
          </Text>

          {!hasSettled ? (
            <Text style={{ color: Theme.sub, fontWeight: "700" }}>
              No settled bets yet.
            </Text>
          ) : confidenceRows.length === 0 ? (
            <Text style={{ color: Theme.sub, fontWeight: "700" }}>
              No settled bets with confidence saved yet.
            </Text>
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
                    <Text style={{ color: Theme.text, fontWeight: "900" }}>
                      {r.label}
                    </Text>
                    <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                      n={r.total}
                    </Text>
                  </View>

                  <Bar
                    value={r.winRate}
                    labelLeft={`Win ${pct(r.winRate)} (${r.wins}W${
                      r.losses ? `–${r.losses}L` : ""
                    }${r.pushes ? `–${r.pushes}P` : ""})`}
                    labelRight={`Avg ${fmtMoney(r.avgStake)}`}
                  />

                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                      Net:{" "}
                      <Text style={{ color: Theme.text, fontWeight: "900" }}>
                        {fmtMoney(r.net)}
                      </Text>
                    </Text>
                    <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                      ROI:{" "}
                      <Text style={{ color: Theme.text, fontWeight: "900" }}>
                        {pct(r.roi)}
                      </Text>
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Section>

        <Section title="Risk mix">
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>
            Based on your selected emotions
          </Text>
          <View style={{ gap: 10 }}>
            <View style={{ gap: 6 }}>
              <Text style={{ color: Theme.text, fontWeight: "900" }}>
                🔴 High-risk vibes: {pct(riskMix.highPct)}
              </Text>
              <Bar value={riskMix.highPct} />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={{ color: Theme.text, fontWeight: "900" }}>
                🟡 Neutral/mixed: {pct(riskMix.midPct)}
              </Text>
              <Bar value={riskMix.midPct} />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={{ color: Theme.text, fontWeight: "900" }}>
                🟢 Controlled: {pct(riskMix.lowPct)}
              </Text>
              <Bar value={riskMix.lowPct} />
            </View>
          </View>
        </Section>

        <Section title="By bet type (top)">
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>
            How different bet types perform (settled bets)
          </Text>
          {betTypeRows.length === 0 ? (
            <Text style={{ color: Theme.sub, fontWeight: "700" }}>
              No settled bets yet.
            </Text>
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
                    <Text style={{ color: Theme.text, fontWeight: "900" }}>
                      {r.label}
                    </Text>
                    <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                      n={r.total}
                    </Text>
                  </View>

                  <Bar
                    value={r.winRate}
                    labelLeft={`Win ${pct(r.winRate)}`}
                    labelRight={`Avg ${fmtMoney(r.avgStake)}`}
                  />

                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                      Net:{" "}
                      <Text style={{ color: Theme.text, fontWeight: "900" }}>
                        {fmtMoney(r.net)}
                      </Text>
                    </Text>
                    <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                      ROI:{" "}
                      <Text style={{ color: Theme.text, fontWeight: "900" }}>
                        {pct(r.roi)}
                      </Text>
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
            <Text style={{ color: Theme.sub, fontWeight: "700" }}>
              No settled bets yet.
            </Text>
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
                    <Text style={{ color: Theme.text, fontWeight: "900" }}>
                      {r.label}
                    </Text>
                    <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                      n={r.total}
                    </Text>
                  </View>

                  <Bar
                    value={r.winRate}
                    labelLeft={`Win ${pct(r.winRate)}`}
                    labelRight={`Avg ${fmtMoney(r.avgStake)}`}
                  />

                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                      Net:{" "}
                      <Text style={{ color: Theme.text, fontWeight: "900" }}>
                        {fmtMoney(r.net)}
                      </Text>
                    </Text>
                    <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                      ROI:{" "}
                      <Text style={{ color: Theme.text, fontWeight: "900" }}>
                        {pct(r.roi)}
                      </Text>
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