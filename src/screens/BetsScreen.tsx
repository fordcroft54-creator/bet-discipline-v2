// src/screens/BetsScreen.tsx
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
  Modal,
} from "react-native";
import { supabase } from "../lib/supabase";
import { Theme } from "../ui/Theme";

/**
 * BetsScreen (refactored)
 * ✅ Keeps filters, list, delete, settle
 * ✅ Edit now navigates to /edit-bet?betId=...
 * ✅ No edit modal code in this file anymore
 */

type Bet = {
  id: string;
  created_at?: string | null;
  placed_at?: string | null;

  sport?: string | null;
  bet_type?: string | null;

  stake?: number | null;
  event_label?: string | null;

  status?: string | null;
  result?: string | null;
  profit?: number | null;

  emotion?: string | null;
  emotions?: string[] | null;
  confidence?: number | null;
};

const RESULT_FILTERS = ["All", "Open", "Win", "Loss", "Push"] as const;
type ResultFilter = (typeof RESULT_FILTERS)[number];

const EMOTIONS: { label: string; value: string }[] = [
  { label: "🎉 Confident", value: "confident" },
  { label: "🧠 Research-based", value: "research" },
  { label: "📊 System play", value: "system" },
  { label: "🗓️ Pre-planned", value: "pre_planned" },
  { label: "🙂 Just for fun", value: "fun" },
  { label: "👯 Social / with friends", value: "social" },
  { label: "🔁 Habit / routine", value: "habit" },
  { label: "😐 Bored", value: "bored" },
  { label: "😬 FOMO", value: "fomo" },
  { label: "⚡ Impulsive", value: "impulsive" },
  { label: "😰 Stressed", value: "stressed" },
  { label: "🍺 Drinking", value: "drinking" },
  { label: "😤 Chasing losses", value: "chasing_losses" },
  { label: "😡 Tilted / frustrated", value: "tilted" },
  { label: "💢 Revenge bet", value: "revenge" },
  { label: "🔁 Doubling down", value: "doubling_down" },
  { label: "😵‍💫 Desperate", value: "desperate" },
];

const EMOTION_LABEL_BY_VALUE: Record<string, string> = EMOTIONS.reduce((acc, e) => {
  acc[e.value] = e.label;
  return acc;
}, {} as Record<string, string>);

function tidy(s?: string | null) {
  if (!s) return "";
  return String(s).replace(/\s+/g, " ").trim();
}

function money0(n: number) {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  return `$${abs.toFixed(0)}`;
}

function moneySigned(n: number) {
  if (!Number.isFinite(n)) return "$0";
  const sign = n > 0 ? "+" : n < 0 ? "–" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toFixed(0)}`;
}

function formatDateShort(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function confidenceLabel(n?: number | null) {
  if (!n || !Number.isFinite(n)) return "";
  const x = Math.round(n);
  if (x <= 1) return "Very low";
  if (x === 2) return "Low";
  if (x === 3) return "Medium";
  if (x === 4) return "High";
  return "Very high";
}

/** Touch-safe SelectModal (reused for filters) */
function SelectModal<T extends string>({
  title,
  visible,
  options,
  selected,
  onSelect,
  onClose,
}: {
  title: string;
  visible: boolean;
  options: readonly T[];
  selected: T;
  onSelect: (v: T) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} presentationStyle="overFullScreen">
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 16, justifyContent: "center" }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: Theme.card,
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: Theme.border,
            maxHeight: "75%",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: Theme.text, fontSize: 16, fontWeight: "900" }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>Close</Text>
            </Pressable>
          </View>

          <View style={{ height: 10 }} />

          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            <View style={{ gap: 10 }}>
              {options.map((opt) => {
                const isSel = selected === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => {
                      onSelect(opt);
                      onClose();
                    }}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: Theme.border,
                      backgroundColor: isSel ? "#ffffff" : "transparent",
                    }}
                  >
                    <Text style={{ color: isSel ? "#0f1115" : Theme.text, fontWeight: "900" }}>{opt}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FilterRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: Theme.card,
        borderWidth: 1,
        borderColor: Theme.border,
        borderRadius: 14,
        padding: 12,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>{label}</Text>
        <Text numberOfLines={1} style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>
          {value}
        </Text>
      </View>
      <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 18 }}>▾</Text>
    </Pressable>
  );
}

function EmptyState({
  filtersActive,
  onClearFilters,
  onLogBet,
}: {
  filtersActive: boolean;
  onClearFilters: () => void;
  onLogBet: () => void;
}) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
      <View
        style={{
          backgroundColor: Theme.card,
          borderWidth: 1,
          borderColor: Theme.border,
          borderRadius: 16,
          padding: 18,
        }}
      >
        <Text style={{ color: Theme.text, fontSize: 20, fontWeight: "900" }}>
          {filtersActive ? "No bets match these filters" : "No bets yet"}
        </Text>

        <Text style={{ color: Theme.sub, marginTop: 8, lineHeight: 21 }}>
          {filtersActive
            ? "Try clearing your filters to see all bets again."
            : "Track your bets here to build your history, review results, and spot patterns in your betting behavior."}
        </Text>

        {!filtersActive ? (
          <View style={{ marginTop: 14, gap: 8 }}>
            <Text style={{ color: Theme.sub, fontWeight: "800" }}>To get started:</Text>

            <View style={{ gap: 6 }}>
              <Text style={{ color: Theme.text }}>1. Log your first bet</Text>
              <Text style={{ color: Theme.text }}>2. Settle it once the result is in</Text>
              <Text style={{ color: Theme.text }}>3. Come back here to track your history</Text>
            </View>
          </View>
        ) : null}

        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          {filtersActive ? (
            <Pressable
              onPress={onClearFilters}
              style={{
                backgroundColor: "#ffffff",
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 12,
              }}
            >
              <Text style={{ color: "#0f1115", fontWeight: "900" }}>Clear filters</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={onLogBet}
              style={{
                backgroundColor: "#ffffff",
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 12,
              }}
            >
              <Text style={{ color: "#0f1115", fontWeight: "900" }}>Log first bet</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

export default function BetsScreen() {
  const router = useRouter();
  const listRef = useRef<FlatList<Bet> | null>(null);

  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterSport, setFilterSport] = useState<string>("All");
  const [filterBetType, setFilterBetType] = useState<string>("All");
  const [filterResult, setFilterResult] = useState<ResultFilter>("All");

  const [filterSportOpen, setFilterSportOpen] = useState(false);
  const [filterBetTypeOpen, setFilterBetTypeOpen] = useState(false);

  const colors = useMemo(() => {
    const t: any = Theme;
    return {
      win: t.success ?? t.green ?? "#22c55e",
      loss: t.danger ?? t.red ?? "#ef4444",
      push: t.sub ?? "#9aa4b2",
      open: t.primary ?? "#60a5fa",
      winBg: t.successBg ?? "rgba(34,197,94,0.14)",
      lossBg: t.dangerBg ?? "rgba(239,68,68,0.14)",
      pushBg: t.mutedBg ?? "rgba(148,163,184,0.10)",
      openBg: t.primaryBg ?? "rgba(96,165,250,0.14)",
    };
  }, []);

  const scrollToTop = useCallback((animated = false) => {
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToOffset({ offset: 0, animated });
      } catch {}
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilterSport("All");
    setFilterBetType("All");
    setFilterResult("All");
    scrollToTop(false);
  }, [scrollToTop]);

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
      .select("id,created_at,placed_at,sport,bet_type,stake,event_label,status,result,profit,emotion,emotions,confidence")
      .eq("user_id", user.id)
      .order("placed_at", { ascending: false, nullsFirst: false })
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
      scrollToTop(false);
      loadBets();
      const t = setTimeout(() => scrollToTop(false), 50);
      return () => clearTimeout(t);
    }, [loadBets, scrollToTop])
  );

  const sportOptions = useMemo(() => {
    const uniq = new Set<string>();
    bets.forEach((b) => {
      const s = tidy(b.sport);
      if (s) uniq.add(s);
    });
    return ["All", ...Array.from(uniq).sort((a, b) => a.localeCompare(b))];
  }, [bets]);

  const betTypeOptions = useMemo(() => {
    const uniq = new Set<string>();
    bets.forEach((b) => {
      const t = tidy(b.bet_type);
      if (t) uniq.add(t);
    });
    return ["All", ...Array.from(uniq).sort((a, b) => a.localeCompare(b))];
  }, [bets]);

  React.useEffect(() => {
    if (filterSport !== "All" && !sportOptions.includes(filterSport)) setFilterSport("All");
    if (filterBetType !== "All" && !betTypeOptions.includes(filterBetType)) setFilterBetType("All");
  }, [sportOptions, betTypeOptions, filterSport, filterBetType]);

  const filteredBets = useMemo(() => {
    return bets.filter((b) => {
      const s = tidy(b.sport);
      const t = tidy(b.bet_type);
      const status = String(b.status ?? "").toLowerCase();
      const result = String(b.result ?? "").toLowerCase();

      if (filterSport !== "All" && s !== filterSport) return false;
      if (filterBetType !== "All" && t !== filterBetType) return false;

      if (filterResult === "All") return true;
      if (filterResult === "Open") return status !== "settled";
      if (filterResult === "Win") return status === "settled" && result === "win";
      if (filterResult === "Loss") return status === "settled" && result === "loss";
      if (filterResult === "Push") return status === "settled" && result === "push";

      return true;
    });
  }, [bets, filterSport, filterBetType, filterResult]);

  const deleteBet = useCallback(
    async (id: string) => {
      Alert.alert("Delete bet?", "This cannot be undone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
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

  const badgeFor = useCallback(
    (isSettled: boolean, resultRaw?: string | null) => {
      if (!isSettled) return { label: "OPEN", fg: colors.open, bg: colors.openBg };
      const r = String(resultRaw ?? "").toLowerCase();
      if (r === "win") return { label: "WIN", fg: colors.win, bg: colors.winBg };
      if (r === "loss") return { label: "LOSS", fg: colors.loss, bg: colors.lossBg };
      if (r === "push") return { label: "PUSH", fg: colors.push, bg: colors.pushBg };
      return { label: "SETTLED", fg: Theme.sub, bg: colors.pushBg };
    },
    [colors]
  );

  const outcomeAmount = useCallback(
    (item: Bet) => {
      const isSettled = (item.status ?? "").toLowerCase() === "settled";
      const stake = Number(item.stake ?? 0);
      const profit = typeof item.profit === "number" ? item.profit : null;
      const r = String(item.result ?? "").toLowerCase();

      if (!isSettled) return { text: "Pending result", color: Theme.sub, big: false };

      if (r === "win") {
        const amt = profit !== null ? profit : stake;
        return { text: moneySigned(Math.max(0, amt)), color: colors.win, big: true };
      }
      if (r === "loss") {
        const amt = profit !== null ? profit : -Math.abs(stake);
        const normalized = amt > 0 ? -amt : amt;
        return { text: moneySigned(normalized), color: colors.loss, big: true };
      }
      if (r === "push") return { text: "$0", color: colors.push, big: true };

      return { text: "Settled", color: Theme.sub, big: false };
    },
    [colors]
  );

  const renderItem = ({ item }: { item: Bet }) => {
    const isSettled = (item.status ?? "").toLowerCase() === "settled";

    const sportLabel = tidy(item.sport);
    const betTypeLabel = tidy(item.bet_type);

    const header =
      sportLabel && betTypeLabel
        ? `${sportLabel} • ${betTypeLabel}`
        : sportLabel
        ? sportLabel
        : betTypeLabel
        ? betTypeLabel
        : "Uncategorized";

    const event = tidy(item.event_label);
    const stake = Number(item.stake ?? 0);

    const rawEmotions: string[] = item.emotions?.length ? item.emotions : item.emotion ? [item.emotion] : [];
    const emotionText = rawEmotions.length
      ? rawEmotions
          .map((e) => EMOTION_LABEL_BY_VALUE[e] ?? e)
          .map((lab) => lab.split(" ")[0])
          .join(" ")
      : "—";

    const conf = item.confidence ?? null;
    const confText = conf && Number.isFinite(conf) ? `${conf}/5 (${confidenceLabel(conf)})` : "—";

    const dateIso = item.placed_at ?? item.created_at ?? null;
    const placed = formatDateShort(dateIso);

    const badge = badgeFor(isSettled, item.result);
    const amt = outcomeAmount(item);

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
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text style={{ fontWeight: "900", fontSize: 16, color: Theme.text, flex: 1 }}>{header}</Text>

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
            <Text style={{ color: badge.fg, fontWeight: "900", letterSpacing: 0.4 }}>{badge.label}</Text>
          </View>
        </View>

        {event ? (
          <Text style={{ marginTop: 6, color: Theme.text, fontWeight: "800" }}>{event}</Text>
        ) : (
          <Text style={{ marginTop: 6, color: Theme.sub }}>(No game/event saved)</Text>
        )}

        <View style={{ marginTop: 10, gap: 6 }}>
          <Text style={{ color: Theme.sub }}>
            Stake: <Text style={{ color: Theme.text, fontWeight: "900" }}>{money0(stake)}</Text>
            {placed ? <Text style={{ color: Theme.sub }}>  •  {placed}</Text> : null}
          </Text>

          <Text style={{ color: Theme.sub }}>
            Confidence: <Text style={{ color: Theme.text, fontWeight: "900" }}>{confText}</Text>
          </Text>

          <Text style={{ color: Theme.sub }}>
            Emotions: <Text style={{ color: Theme.text, fontWeight: "900" }}>{emotionText}</Text>
          </Text>
        </View>

        <View style={{ height: 1, backgroundColor: Theme.border, opacity: 0.7, marginTop: 12 }} />

        <View style={{ marginTop: 10 }}>
          <Text style={{ color: amt.color, fontWeight: "900", fontSize: amt.big ? 22 : 14 }}>{amt.text}</Text>
          {amt.big ? (
            <Text style={{ color: Theme.sub, marginTop: 2, fontWeight: "800" }}>
              {isSettled ? "Result impact" : "Waiting to settle"}
            </Text>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", marginTop: 12, gap: 10 }}>
          <Pressable
            onPress={() => router.push(`/settle-bet?betId=${encodeURIComponent(item.id)}`)}
            disabled={isSettled}
            style={{
              backgroundColor: isSettled ? "#2a3140" : "#ffffff",
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 10,
            }}
          >
            <Text style={{ color: isSettled ? "#9aa4b2" : "#0f1115", fontWeight: "900" }}>
              {isSettled ? "Settled" : "Settle"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() =>
              router.push({
                pathname: "/edit-bet",
                params: { betId: item.id },
              } as any)
            }
            style={{
              backgroundColor: "#232a3a",
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: Theme.border,
            }}
          >
            <Text style={{ color: Theme.text, fontWeight: "900" }}>Edit</Text>
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

  const filtersActive = filterSport !== "All" || filterBetType !== "All" || filterResult !== "All";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
      <SelectModal
        title="Filter sport"
        visible={filterSportOpen}
        options={sportOptions as any}
        selected={filterSport as any}
        onSelect={(v) => setFilterSport(String(v))}
        onClose={() => setFilterSportOpen(false)}
      />

      <SelectModal
        title="Filter bet type"
        visible={filterBetTypeOpen}
        options={betTypeOptions as any}
        selected={filterBetType as any}
        onSelect={(v) => setFilterBetType(String(v))}
        onClose={() => setFilterBetTypeOpen(false)}
      />

      <FlatList
        ref={(r) => {
          listRef.current = r;
        }}
        data={filteredBets}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: Theme.text, fontSize: 26, fontWeight: "900" }}>Bets</Text>
              {filtersActive ? (
                <Pressable
                  onPress={clearFilters}
                  hitSlop={10}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: Theme.border,
                  }}
                >
                  <Text style={{ color: Theme.sub, fontWeight: "900" }}>Clear</Text>
                </Pressable>
              ) : null}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {RESULT_FILTERS.map((r) => {
                const selected = filterResult === r;
                return (
                  <Pressable
                    key={r}
                    onPress={() => {
                      setFilterResult(r);
                      scrollToTop(false);
                    }}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: selected ? "#ffffff" : Theme.border,
                      backgroundColor: selected ? "#ffffff" : "transparent",
                    }}
                  >
                    <Text style={{ color: selected ? "#0f1115" : Theme.text, fontWeight: "900" }}>{r}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <FilterRow label="Sport" value={filterSport} onPress={() => setFilterSportOpen(true)} />
              <FilterRow label="Bet Type" value={filterBetType} onPress={() => setFilterBetTypeOpen(true)} />
            </View>

            <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>
              Showing <Text style={{ color: Theme.text, fontWeight: "900" }}>{filteredBets.length}</Text>{" "}
              {filteredBets.length === 1 ? "bet" : "bets"}
            </Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 30 }} />
          ) : (
            <EmptyState
              filtersActive={filtersActive}
              onClearFilters={clearFilters}
              onLogBet={() => router.push("/log")}
            />
          )
        }
      />
    </SafeAreaView>
  );
}