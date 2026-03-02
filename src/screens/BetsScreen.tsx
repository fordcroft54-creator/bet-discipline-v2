import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "../lib/supabase";
import { Theme } from "../ui/Theme";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";

/**
 * BetsScreen (FULL UPDATED)
 * ✅ Auto-scrolls to top when the Bets tab is focused
 * ✅ Keeps your filters + edit flow + date quick picks + calendar
 */

type Bet = {
  id: string;
  created_at?: string | null;
  placed_at?: string | null;

  sport?: string | null;
  bet_type?: string | null;

  stake?: number | null;
  event_label?: string | null;

  status?: string | null; // "open" | "settled"
  result?: string | null; // "win" | "loss" | "push" | null
  profit?: number | null;

  emotion?: string | null;
  emotions?: string[] | null;

  confidence?: number | null; // 1..5
};

const RESULT_FILTERS = ["All", "Open", "Win", "Loss", "Push"] as const;
type ResultFilter = (typeof RESULT_FILTERS)[number];

const EMOTIONS: { label: string; value: string }[] = [
  // Strategic
  { label: "🎉 Confident", value: "confident" },
  { label: "🧠 Research-based", value: "research" },
  { label: "📊 System play", value: "system" },
  { label: "🗓️ Pre-planned", value: "pre_planned" },

  // Recreational
  { label: "🙂 Just for fun", value: "fun" },
  { label: "👯 Social / with friends", value: "social" },
  { label: "🔁 Habit / routine", value: "habit" },

  // Situational
  { label: "😐 Bored", value: "bored" },
  { label: "😬 FOMO", value: "fomo" },
  { label: "⚡ Impulsive", value: "impulsive" },
  { label: "😰 Stressed", value: "stressed" },
  { label: "🍺 Drinking", value: "drinking" },

  // Reactive
  { label: "😤 Chasing losses", value: "chasing_losses" },
  { label: "😡 Tilted / frustrated", value: "tilted" },
  { label: "💢 Revenge bet", value: "revenge" },
  { label: "🔁 Doubling down", value: "doubling_down" },
  { label: "😵‍💫 Desperate", value: "desperate" },
];

const EMOTION_LABEL_BY_VALUE: Record<string, string> = EMOTIONS.reduce(
  (acc, e) => {
    acc[e.value] = e.label;
    return acc;
  },
  {} as Record<string, string>
);

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

function toNumStake(s: string) {
  const cleaned = (s ?? "").replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function sameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatPrettyDate(d: Date) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return d.toDateString();
  }
}

/** For backdated picks: set midday to avoid timezone edges */
function normalizePickedDate(picked: Date) {
  const now = new Date();
  const d = new Date(picked);
  if (sameLocalDay(d, now)) {
    d.setHours(now.getHours(), now.getMinutes(), 0, 0);
  } else {
    d.setHours(12, 0, 0, 0);
  }
  return d;
}

/**
 * The modal pattern that reliably avoids "can't click inside":
 * - outer Pressable closes
 * - inner Pressable eats taps
 */
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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          padding: 16,
          justifyContent: "center",
        }}
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

function FilterRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
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

export default function BetsScreen() {
  const router = useRouter();

  const listRef = useRef<FlatList<Bet> | null>(null);

  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  // FILTER STATE
  const [filterSport, setFilterSport] = useState<string>("All");
  const [filterBetType, setFilterBetType] = useState<string>("All");
  const [filterResult, setFilterResult] = useState<ResultFilter>("All");

  const [filterSportOpen, setFilterSportOpen] = useState(false);
  const [filterBetTypeOpen, setFilterBetTypeOpen] = useState(false);

  // EDIT MODAL STATE
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editBetId, setEditBetId] = useState<string | null>(null);

  const [sport, setSport] = useState("");
  const [betType, setBetType] = useState("");
  const [stakeText, setStakeText] = useState("");
  const [eventLabel, setEventLabel] = useState("");
  const [selectedEmotions, setSelectedEmotions] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);

  // edit bet date
  const [editPlacedAt, setEditPlacedAt] = useState<Date>(() => new Date());
  const [editDateModalOpen, setEditDateModalOpen] = useState(false);
  const [editCalendarOpen, setEditCalendarOpen] = useState(false);
  const [iosDraftDate, setIosDraftDate] = useState<Date>(() => new Date());

  const [sportOpen, setSportOpen] = useState(false);
  const [betTypeOpen, setBetTypeOpen] = useState(false);

  const editScrollRef = useRef<React.ElementRef<typeof ScrollView> | null>(null);

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
    // Run on next frame so the list is laid out (helps reliability on tab switch)
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToOffset({ offset: 0, animated });
      } catch {
        // ignore
      }
    });
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

  // ✅ When navigating to the Bets tab (screen focus), scroll to top + refresh
  useFocusEffect(
    useCallback(() => {
      scrollToTop(false); // immediate snap to top on tab focus
      loadBets();

      // Optional: also snap to top again after data loads / layout settles
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportOptions, betTypeOptions]);

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
    [colors.open, colors.openBg, colors.win, colors.winBg, colors.loss, colors.lossBg, colors.push, colors.pushBg]
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
    [Theme.sub, colors.win, colors.loss, colors.push]
  );

  const openEdit = useCallback((b: Bet) => {
    const rawEmotions: string[] = b.emotions?.length ? b.emotions : b.emotion ? [b.emotion] : [];
    const iso = b.placed_at ?? b.created_at ?? null;
    const dt = iso ? new Date(iso) : new Date();
    const safeDate = Number.isNaN(dt.getTime()) ? new Date() : dt;

    setEditBetId(b.id);
    setSport(tidy(b.sport));
    setBetType(tidy(b.bet_type));
    setStakeText(typeof b.stake === "number" && Number.isFinite(b.stake) ? String(b.stake) : "");
    setEventLabel(tidy(b.event_label));
    setSelectedEmotions(rawEmotions.filter(Boolean).slice(0, 3));
    setConfidence(
      typeof b.confidence === "number" && Number.isFinite(b.confidence)
        ? clamp(Math.round(b.confidence), 1, 5)
        : null
    );
    setEditPlacedAt(safeDate);

    setEditOpen(true);
    setTimeout(() => editScrollRef.current?.scrollTo({ y: 0, animated: false }), 0);
  }, []);

  const closeEdit = useCallback(() => {
    Keyboard.dismiss();
    setEditOpen(false);
    setSportOpen(false);
    setBetTypeOpen(false);
    setEditDateModalOpen(false);
    setEditCalendarOpen(false);
  }, []);

  const toggleEmotion = useCallback((val: string) => {
    setSelectedEmotions((prev) => {
      const has = prev.includes(val);
      if (has) return prev.filter((x) => x !== val);
      if (prev.length >= 3) return prev;
      return [...prev, val];
    });
  }, []);

  const canSaveEdit = useMemo(() => {
    return !!tidy(sport) && !!tidy(betType) && toNumStake(stakeText) > 0 && !!editBetId;
  }, [sport, betType, stakeText, editBetId]);

  const editPlacedAtLabel = useMemo(() => {
    const d = editPlacedAt instanceof Date && !Number.isNaN(editPlacedAt.getTime()) ? editPlacedAt : new Date();
    const now = new Date();
    if (sameLocalDay(d, now)) return `Today · ${formatPrettyDate(d)}`;
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (sameLocalDay(d, y)) return `Yesterday · ${formatPrettyDate(d)}`;
    return formatPrettyDate(d);
  }, [editPlacedAt]);

  const setEditDateDaysAgo = (daysAgo: number) => {
    const now = new Date();
    const d = new Date(now);
    d.setDate(now.getDate() - daysAgo);
    setEditPlacedAt(normalizePickedDate(d));
  };

  const openEditOtherCalendar = () => {
    setEditDateModalOpen(false);
    if (Platform.OS === "ios") {
      setIosDraftDate(editPlacedAt);
      setEditCalendarOpen(true);
    } else {
      setEditCalendarOpen(true);
    }
  };

  const saveEdit = useCallback(async () => {
    Keyboard.dismiss();
    if (!editBetId) return;

    const stake = toNumStake(stakeText);
    if (!tidy(sport)) return Alert.alert("Missing", "Pick a sport.");
    if (!tidy(betType)) return Alert.alert("Missing", "Pick a bet type.");
    if (!Number.isFinite(stake) || stake <= 0) return Alert.alert("Missing", "Enter a valid stake.");

    const placedAtIso =
      editPlacedAt instanceof Date && !Number.isNaN(editPlacedAt.getTime())
        ? editPlacedAt.toISOString()
        : null;

    setEditSaving(true);
    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) throw new Error("Not logged in.");

      const payload = {
        sport: tidy(sport),
        bet_type: tidy(betType),
        stake,
        event_label: tidy(eventLabel) || null,
        emotions: selectedEmotions.length ? selectedEmotions : null,
        emotion: selectedEmotions.length ? selectedEmotions[0] : null,
        confidence: confidence ?? null,
        placed_at: placedAtIso,
      };

      setBets((prev) => prev.map((b) => (b.id === editBetId ? { ...b, ...payload } : b)));

      const { error } = await supabase.from("bets").update(payload).eq("id", editBetId).eq("user_id", user.id);

      if (error) throw error;

      closeEdit();
      loadBets();
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Try again.");
      loadBets();
    } finally {
      setEditSaving(false);
    }
  }, [
    editBetId,
    sport,
    betType,
    stakeText,
    eventLabel,
    selectedEmotions,
    confidence,
    editPlacedAt,
    closeEdit,
    loadBets,
  ]);

  const renderItem = ({ item }: { item: Bet }) => {
    const isSettled = (item.status ?? "").toLowerCase() === "settled";

    const sportLabel = tidy(item.sport) || "Sport";
    const betTypeLabel = tidy(item.bet_type) || "Bet";
    const header = `${sportLabel} • ${betTypeLabel}`;

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
            onPress={() => openEdit(item)}
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
      {/* Filter dropdown modals */}
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
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: Theme.text, fontSize: 26, fontWeight: "900" }}>Bets</Text>
              {filtersActive ? (
                <Pressable
                  onPress={() => {
                    setFilterSport("All");
                    setFilterBetType("All");
                    setFilterResult("All");
                    scrollToTop(false);
                  }}
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

            {/* Result pills */}
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

            {/* Dropdown filter rows */}
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
            <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
              <Text style={{ color: Theme.sub }}>{filtersActive ? "No bets match your filters." : "No bets yet."}</Text>
            </View>
          )
        }
      />

      {/* ===================== EDIT MODAL (TOUCH-SAFE) ===================== */}
      <Modal
        visible={editOpen}
        transparent
        animationType="fade"
        onRequestClose={closeEdit}
        presentationStyle="overFullScreen"
      >
        <Pressable
          onPress={closeEdit}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 16, justifyContent: "center" }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              width: "100%",
              height: "88%",
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 14,
            }}
          >
            <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18 }}>Edit Bet</Text>

            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}
              style={{ flex: 1 }}
            >
              <ScrollView
                ref={(r) => {
                  editScrollRef.current = r;
                }}
                style={{ flex: 1, marginTop: 12 }}
                contentContainerStyle={{ gap: 12, paddingBottom: 18 }}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {/* Bet Date (CLICKABLE) */}
                <Pressable
                  onPress={() => setEditDateModalOpen(true)}
                  style={{
                    backgroundColor: Theme.bg,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: Theme.border,
                    padding: 12,
                    gap: 6,
                  }}
                >
                  <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Bet date</Text>
                  <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>{editPlacedAtLabel}</Text>
                </Pressable>

                {/* Sport + Bet Type */}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable
                    onPress={() => setSportOpen(true)}
                    style={{
                      flex: 1,
                      backgroundColor: Theme.bg,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: Theme.border,
                      padding: 12,
                      gap: 6,
                    }}
                  >
                    <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Sport</Text>
                    <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>
                      {sport ? sport : "Select"}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setBetTypeOpen(true)}
                    style={{
                      flex: 1,
                      backgroundColor: Theme.bg,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: Theme.border,
                      padding: 12,
                      gap: 6,
                    }}
                  >
                    <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Bet type</Text>
                    <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>
                      {betType ? betType : "Select"}
                    </Text>
                  </Pressable>
                </View>

                {/* Stake */}
                <View style={{ gap: 6 }}>
                  <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Stake</Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      backgroundColor: Theme.bg,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: Theme.border,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                    }}
                  >
                    <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 18 }}>$</Text>
                    <TextInput
                      value={stakeText}
                      onChangeText={setStakeText}
                      keyboardType="numeric"
                      returnKeyType="done"
                      onSubmitEditing={() => Keyboard.dismiss()}
                      placeholderTextColor={Theme.sub}
                      style={{
                        flex: 1,
                        color: Theme.text,
                        fontWeight: "800",
                        fontSize: 16,
                        paddingVertical: 0,
                      }}
                    />
                  </View>
                </View>

                {/* Event */}
                <View style={{ gap: 6 }}>
                  <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Game / Event</Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      backgroundColor: Theme.bg,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: Theme.border,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                    }}
                  >
                    <TextInput
                      value={eventLabel}
                      onChangeText={setEventLabel}
                      returnKeyType="done"
                      onSubmitEditing={() => Keyboard.dismiss()}
                      placeholder="e.g. Hawks vs Heat"
                      placeholderTextColor={Theme.sub}
                      style={{
                        flex: 1,
                        color: Theme.text,
                        fontWeight: "800",
                        fontSize: 16,
                        paddingVertical: 0,
                      }}
                    />
                  </View>
                </View>

                {/* Confidence */}
                <View style={{ gap: 8 }}>
                  <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Confidence</Text>
                  <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                    {[1, 2, 3, 4, 5].map((n) => {
                      const selected = confidence === n;
                      const label =
                        n === 1 ? "Very low" : n === 2 ? "Low" : n === 3 ? "Medium" : n === 4 ? "High" : "Very high";

                      return (
                        <Pressable
                          key={n}
                          onPress={() => setConfidence((prev) => (prev === n ? null : n))}
                          style={{
                            paddingVertical: 10,
                            paddingHorizontal: 12,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: selected ? "#ffffff" : Theme.border,
                            backgroundColor: selected ? "#ffffff" : "transparent",
                            minWidth: 110,
                            alignItems: "center",
                          }}
                        >
                          <Text style={{ color: selected ? "#0f1115" : Theme.text, fontWeight: "900" }}>
                            {n}/5 {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {/* Emotions */}
                <View style={{ gap: 8 }}>
                  <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Emotions (up to 3)</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    {EMOTIONS.map((e) => (
                      <Chip
                        key={e.value}
                        label={e.label}
                        selected={selectedEmotions.includes(e.value)}
                        onPress={() => toggleEmotion(e.value)}
                      />
                    ))}
                  </View>
                  <Text style={{ color: Theme.sub, fontWeight: "700" }}>
                    Selected{" "}
                    <Text style={{ color: Theme.text, fontWeight: "900" }}>{selectedEmotions.length}</Text>/3
                  </Text>
                </View>

                <Button
                  title={editSaving ? "Saving…" : "Save Changes"}
                  onPress={saveEdit}
                  disabled={!canSaveEdit || editSaving}
                />

                <Pressable onPress={closeEdit} style={{ alignItems: "center", paddingVertical: 10 }}>
                  <Text style={{ color: Theme.sub, fontWeight: "900" }}>Cancel</Text>
                </Pressable>
              </ScrollView>
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ===================== EDIT DATE QUICK PICKS ===================== */}
      <Modal
        visible={editDateModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setEditDateModalOpen(false)}
        presentationStyle="overFullScreen"
      >
        <Pressable
          onPress={() => setEditDateModalOpen(false)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            padding: 16,
            justifyContent: "flex-end",
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 14,
              maxHeight: "70%",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: Theme.text, fontSize: 16, fontWeight: "900" }}>Edit bet date</Text>
              <Pressable onPress={() => setEditDateModalOpen(false)} hitSlop={10}>
                <Text style={{ color: Theme.sub, fontWeight: "800" }}>Close</Text>
              </Pressable>
            </View>

            <View style={{ height: 10 }} />

            <Text style={{ color: Theme.sub, fontWeight: "800" }}>Quick picks</Text>
            <View style={{ height: 10 }} />

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Chip
                label="Today"
                selected={sameLocalDay(editPlacedAt, new Date())}
                onPress={() => {
                  setEditDateDaysAgo(0);
                  setEditDateModalOpen(false);
                }}
              />
              <Chip
                label="Yesterday"
                selected={(() => {
                  const n = new Date();
                  n.setDate(n.getDate() - 1);
                  return sameLocalDay(editPlacedAt, n);
                })()}
                onPress={() => {
                  setEditDateDaysAgo(1);
                  setEditDateModalOpen(false);
                }}
              />
              <Chip
                label="2 days ago"
                selected={false}
                onPress={() => {
                  setEditDateDaysAgo(2);
                  setEditDateModalOpen(false);
                }}
              />
              <Chip
                label="3 days ago"
                selected={false}
                onPress={() => {
                  setEditDateDaysAgo(3);
                  setEditDateModalOpen(false);
                }}
              />
              <Chip label="Other…" selected={false} onPress={openEditOtherCalendar} />
            </View>

            <View style={{ height: 10 }} />
            <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "700" }}>
              Past dates are saved at midday to avoid timezone edge cases.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ===================== EDIT DATE CALENDAR (iOS inline, Android native) ===================== */}
      <Modal
        visible={Platform.OS === "ios" && editCalendarOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setEditCalendarOpen(false)}
        presentationStyle="overFullScreen"
      >
        <Pressable
          onPress={() => setEditCalendarOpen(false)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            padding: 16,
            justifyContent: "flex-end",
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 14,
              maxHeight: "75%",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: Theme.text, fontSize: 16, fontWeight: "900" }}>Pick a date</Text>
              <Pressable onPress={() => setEditCalendarOpen(false)} hitSlop={10}>
                <Text style={{ color: Theme.sub, fontWeight: "800" }}>Close</Text>
              </Pressable>
            </View>

            <View style={{ height: 10 }} />

            <View
              style={{
                backgroundColor: Theme.bg,
                borderWidth: 1,
                borderColor: Theme.border,
                borderRadius: 16,
                overflow: "hidden",
              }}
            >
              <DateTimePicker
                value={iosDraftDate}
                mode="date"
                display="inline"
                onChange={(_event, selected) => {
                  if (!selected) return;
                  setIosDraftDate(selected);
                }}
              />
            </View>

            <View style={{ height: 12 }} />

            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" onPress={() => setEditCalendarOpen(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Apply"
                  onPress={() => {
                    setEditPlacedAt(normalizePickedDate(iosDraftDate));
                    setEditCalendarOpen(false);
                  }}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {Platform.OS === "android" && editCalendarOpen && (
        <DateTimePicker
          value={editPlacedAt}
          mode="date"
          display="default"
          onChange={(_event, selected) => {
            setEditCalendarOpen(false);
            if (!selected) return;
            setEditPlacedAt(normalizePickedDate(selected));
          }}
        />
      )}

      {/* ===================== SPORT PICKER (EDIT) ===================== */}
      <SelectModal
        title="Select sport"
        visible={sportOpen}
        options={sportOptions.filter((x) => x !== "All") as any}
        selected={(sport || (sportOptions[1] ?? "")) as any}
        onSelect={(v) => setSport(String(v))}
        onClose={() => setSportOpen(false)}
      />

      {/* ===================== BET TYPE PICKER (EDIT) ===================== */}
      <SelectModal
        title="Select bet type"
        visible={betTypeOpen}
        options={betTypeOptions.filter((x) => x !== "All") as any}
        selected={(betType || (betTypeOptions[1] ?? "")) as any}
        onSelect={(v) => setBetType(String(v))}
        onClose={() => setBetTypeOpen(false)}
      />
    </SafeAreaView>
  );
}