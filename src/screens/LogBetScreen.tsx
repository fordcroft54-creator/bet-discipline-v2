// src/screens/LogBetScreen.tsx
import { useFocusEffect, router } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "../lib/supabase";
import { useAppStore } from "../store/useAppStore";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Field } from "../ui/Field";
import { Theme } from "../ui/Theme";

/**
 * LogBetScreen (REDESIGNED v3)
 * ✅ Date required + top
 * ✅ Stake required, keyboard shows "Done" (returnKeyType="done")
 * ✅ Confidence required (Mid label)
 * ✅ Bet summary required
 * ✅ Emotions optional but encouraged; max selected = 3
 * ✅ Emotions expand inline under each group
 * ✅ Details optional; sport/bet type are NOT preselected (null until user picks)
 * ✅ Removed redundant tip line under bet summary
 */

const SPORTS = [
  "NFL",
  "NBA",
  "MLB",
  "College Football",
  "College Basketball",
  "NHL",
  "Soccer",
  "Tennis",
  "Golf",
  "MMA / UFC",
  "Other",
] as const;

const BET_TYPES = [
  "Straight / Moneyline",
  "Spread",
  "Total (Over/Under)",
  "Parlay",
  "Same Game Parlay",
  "Prop Bet",
  "Live Bet",
  "Future",
  "Other",
] as const;

const EMOTION_GROUPS = {
  strategic: {
    title: "🎯 Strategic",
    subtitle: "Intentional, thought-out bets",
    items: [
      { label: "🎉 Confident", value: "confident" },
      { label: "🧠 Research-based", value: "research" },
      { label: "📊 System play", value: "system" },
      { label: "🗓️ Pre-planned", value: "pre_planned" },
    ],
  },
  recreational: {
    title: "🎉 Recreational",
    subtitle: "For fun or social vibes",
    items: [
      { label: "🙂 Just for fun", value: "fun" },
      { label: "👯 Social / with friends", value: "social" },
      { label: "🔁 Habit / routine", value: "habit" },
    ],
  },
  situational: {
    title: "⚠️ Situational",
    subtitle: "Not bad — just worth noticing",
    items: [
      { label: "😐 Bored", value: "bored" },
      { label: "😬 FOMO", value: "fomo" },
      { label: "⚡ Impulsive", value: "impulsive" },
      { label: "😰 Stressed", value: "stressed" },
      { label: "🍺 Drinking", value: "drinking" },
    ],
  },
  reactive: {
    title: "🔥 Reactive",
    subtitle: "Emotion-driven patterns to watch",
    items: [
      { label: "😤 Chasing losses", value: "chasing_losses" },
      { label: "😡 Tilted / frustrated", value: "tilted" },
      { label: "💢 Revenge bet", value: "revenge" },
      { label: "🔁 Doubling down", value: "doubling_down" },
      { label: "😵‍💫 Desperate", value: "desperate" },
    ],
  },
} as const;

type Sport = (typeof SPORTS)[number];
type BetType = (typeof BET_TYPES)[number];

type Emotion =
  | (typeof EMOTION_GROUPS.strategic.items)[number]["value"]
  | (typeof EMOTION_GROUPS.recreational.items)[number]["value"]
  | (typeof EMOTION_GROUPS.situational.items)[number]["value"]
  | (typeof EMOTION_GROUPS.reactive.items)[number]["value"];

type Confidence = 1 | 2 | 3 | 4 | 5;

const ALL_EMOTIONS = [
  ...EMOTION_GROUPS.strategic.items,
  ...EMOTION_GROUPS.recreational.items,
  ...EMOTION_GROUPS.situational.items,
  ...EMOTION_GROUPS.reactive.items,
] as const;

const EMOTION_LABEL_BY_VALUE: Record<string, string> = ALL_EMOTIONS.reduce(
  (acc, e) => {
    acc[e.value] = e.label;
    return acc;
  },
  {} as Record<string, string>
);

type EmotionGroupKey = keyof typeof EMOTION_GROUPS;

/** ✅ Touch-safe sheet modal: backdrop is its own layer BEHIND content */
function SheetModal({
  visible,
  onClose,
  children,
  position = "bottom",
  maxHeight = "80%",
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  position?: "bottom" | "center";
  maxHeight?: number | string;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={[
          styles.modalWrap,
          { justifyContent: position === "center" ? "center" : "flex-end" },
        ]}
        pointerEvents="box-none"
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: Theme.card,
              borderColor: Theme.border,
              maxHeight: (maxHeight ?? "80%") as any,
            },
          ]}
        >
          {children}
        </View>
      </View>
    </Modal>
  );
}

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
    <SheetModal visible={visible} onClose={onClose} position="bottom" maxHeight="70%">
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: Theme.text, fontSize: 16, fontWeight: "900" }}>{title}</Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>Close</Text>
        </Pressable>
      </View>

      <View style={{ height: 10 }} />

      <ScrollView keyboardShouldPersistTaps="always">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {options.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              selected={selected === opt}
              onPress={() => {
                onSelect(opt);
                onClose();
              }}
            />
          ))}
        </View>
      </ScrollView>
    </SheetModal>
  );
}

function BetDateModal({
  visible,
  placedAtLabel,
  onClose,
  onPickQuick,
  onPickOther,
}: {
  visible: boolean;
  placedAtLabel: string;
  onClose: () => void;
  onPickQuick: (daysAgo: number) => void;
  onPickOther: () => void;
}) {
  return (
    <SheetModal visible={visible} onClose={onClose} position="bottom" maxHeight="55%">
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={{ color: Theme.text, fontSize: 16, fontWeight: "900" }}>Bet date</Text>
          <Text style={{ color: Theme.sub, fontWeight: "800", marginTop: 2 }}>{placedAtLabel}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={{ color: Theme.sub, fontWeight: "900" }}>Close</Text>
        </Pressable>
      </View>

      <View style={{ height: 12 }} />

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Chip label="Today" selected={false} onPress={() => (onPickQuick(0), onClose())} />
        <Chip label="Yesterday" selected={false} onPress={() => (onPickQuick(1), onClose())} />
        <Chip label="2 days ago" selected={false} onPress={() => (onPickQuick(2), onClose())} />
        <Chip label="3 days ago" selected={false} onPress={() => (onPickQuick(3), onClose())} />
        <Chip
          label="Other…"
          selected={false}
          onPress={() => {
            onClose();
            onPickOther();
          }}
        />
      </View>

      <View style={{ height: 14 }} />
      <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "700" }}>
        Tip: “Other…” lets you pick any date.
      </Text>
    </SheetModal>
  );
}

function SelectRow({
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
        backgroundColor: Theme.card,
        borderWidth: 1,
        borderColor: Theme.border,
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "800" }}>{label}</Text>
        <Text style={{ color: Theme.text, fontSize: 16, fontWeight: "900", marginTop: 2 }}>
          {value}
        </Text>
      </View>
      <Text style={{ color: Theme.sub, fontSize: 18, fontWeight: "900" }}>▾</Text>
    </Pressable>
  );
}

function money(n: number) {
  if (!Number.isFinite(n)) return "$0";
  return `$${Math.round(n).toLocaleString()}`;
}

function startOfWeekLocal(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // Monday
  x.setDate(x.getDate() + diff);
  return x;
}

function endOfWeekLocalExclusive(d: Date) {
  const s = startOfWeekLocal(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 7);
  return e;
}

function startOfMonthLocal(d: Date) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfMonthLocalExclusive(d: Date) {
  const s = startOfMonthLocal(d);
  const e = new Date(s);
  e.setMonth(e.getMonth() + 1);
  return e;
}

/** weekly budget applies only to CURRENT local week */
function isSameLocalWeek(a: Date, b: Date) {
  const sa = startOfWeekLocal(a).getTime();
  const sb = startOfWeekLocal(b).getTime();
  return sa === sb;
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

function sameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function ConfidencePill({
  label,
  selected,
  onPress,
  flexGrow,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  flexGrow: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexGrow,
        flexBasis: 0,
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? Theme.text : Theme.border,
        backgroundColor: Theme.card,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text numberOfLines={1} style={{ color: Theme.text, fontWeight: "900", fontSize: 11 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SmallHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>{title}</Text>
      {subtitle ? (
        <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 12 }}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

export default function LogBetScreen() {
  const bump = useAppStore((s) => s.bump);
  const scrollRef = useRef<ScrollView>(null);

  // Details (optional)
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Required top: date
  const [placedAt, setPlacedAt] = useState<Date>(() => new Date());
  const [betDateModalOpen, setBetDateModalOpen] = useState(false);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [iosCalendarDraft, setIosCalendarDraft] = useState<Date>(() => new Date());

  // Optional details (NOT preselected)
  const [sport, setSport] = useState<Sport | null>(null);
  const [betType, setBetType] = useState<BetType | null>(null);
  const [sportOther, setSportOther] = useState("");
  const [betTypeOther, setBetTypeOther] = useState("");
  const [sportOpen, setSportOpen] = useState(false);
  const [betTypeOpen, setBetTypeOpen] = useState(false);

  // Core required
  const [stake, setStake] = useState("");
  const [confidence, setConfidence] = useState<Confidence | null>(null);

  // Memory anchor required
  const [betSummary, setBetSummary] = useState("");

  // Why (optional but encouraged)
  const WHY_MAX = 3; // ✅ requested
  const [openGroup, setOpenGroup] = useState<EmotionGroupKey | null>(null);
  const [emotions, setEmotions] = useState<Emotion[]>([]);

  const [busy, setBusy] = useState(false);

  // Modals for budget/caps (unchanged)
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetModalData, setBudgetModalData] = useState<{
    budget: number;
    used: number;
    thisBet: number;
  } | null>(null);

  const [capWarningOpen, setCapWarningOpen] = useState(false);
  const [capWarning, setCapWarning] = useState<{
    weeklyBudget?: number;
    weeklyUsed?: number;
    weeklyOver?: number;
    monthlyLossCap?: number;
    monthlyLossUsed?: number;
    monthlyOver?: number;
  } | null>(null);

  const stakeNum = useMemo(() => Number(stake), [stake]);

  const stakeRef = useRef<TextInput | null>(null);
  const summaryRef = useRef<any>(null);

  // Scroll-to-stake behavior retained (used in budget modal)
  const stakeYRef = useRef<number>(0);
  const scrollToStakeWithOffset = (animated = true) => {
    const h = Dimensions.get("window").height || 800;
    const offset = Math.round(h * 0.1);
    const targetY = Math.max(0, stakeYRef.current - offset);
    scrollRef.current?.scrollTo({ y: targetY, animated });
  };

  const normalizedSport = useMemo(() => {
    if (!sport) return null;
    if (sport !== "Other") return sport;
    const v = sportOther.trim();
    return v ? v : "Other";
  }, [sport, sportOther]);

  const normalizedBetType = useMemo(() => {
    if (!betType) return null;
    if (betType !== "Other") return betType;
    const v = betTypeOther.trim();
    return v ? v : "Other";
  }, [betType, betTypeOther]);

  const confidenceLabel = useMemo(() => {
    if (confidence == null) return "—";
    if (confidence === 1) return "Very low";
    if (confidence === 2) return "Low";
    if (confidence === 3) return "Mid";
    if (confidence === 4) return "High";
    return "Very high";
  }, [confidence]);

  const placedAtLabel = useMemo(() => {
    const now = new Date();
    if (sameLocalDay(placedAt, now)) return `Today · ${formatPrettyDate(placedAt)}`;
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (sameLocalDay(placedAt, y)) return `Yesterday · ${formatPrettyDate(placedAt)}`;
    return formatPrettyDate(placedAt);
  }, [placedAt]);

  const applyPickedDate = (pickedDate: Date) => {
    const now = new Date();
    const d = new Date(pickedDate);

    if (sameLocalDay(d, now)) {
      d.setHours(now.getHours(), now.getMinutes(), 0, 0);
    } else {
      d.setHours(12, 0, 0, 0);
    }
    setPlacedAt(d);
  };

  const setPlacedAtDaysAgo = (daysAgo: number) => {
    const now = new Date();
    const d = new Date(now);
    d.setDate(now.getDate() - daysAgo);

    if (daysAgo === 0) {
      d.setHours(now.getHours(), now.getMinutes(), 0, 0);
    } else {
      d.setHours(12, 0, 0, 0);
    }
    setPlacedAt(d);
  };

  const openOtherCalendar = () => {
    setBetDateModalOpen(false);
    if (Platform.OS === "ios") setIosCalendarDraft(placedAt);
    setCalendarOpen(true);
  };

  const selectedWhyLabels = useMemo(() => {
    return emotions.map((v) => EMOTION_LABEL_BY_VALUE[v] ?? v);
  }, [emotions]);

  const toggleWhy = (v: Emotion) => {
    setEmotions((prev) => {
      const has = prev.includes(v);
      if (has) return prev.filter((x) => x !== v);

      if (prev.length >= WHY_MAX) {
        Alert.alert("Too many selections", `Pick up to ${WHY_MAX}.`);
        return prev;
      }
      return [...prev, v];
    });
  };

  const clearWhy = () => {
    setEmotions([]);
    setOpenGroup(null);
  };

  const getGoals = async (userId: string) => {
    const g = await supabase
      .from("goals")
      .select("weekly_budget, max_bet, monthly_loss_cap")
      .eq("user_id", userId)
      .maybeSingle();

    if (g.error) throw g.error;

    const weeklyBudget = Number((g.data as any)?.weekly_budget ?? 0);
    const maxBet = Number((g.data as any)?.max_bet ?? 0);
    const monthlyLossCap = Number((g.data as any)?.monthly_loss_cap ?? 0);

    return { weeklyBudget, maxBet, monthlyLossCap };
  };

  const getWeeklyUsedForDate = async (userId: string, anchor: Date) => {
    const start = startOfWeekLocal(anchor);
    const end = endOfWeekLocalExclusive(anchor);

    const usedRes = await supabase
      .from("bets")
      .select("stake, placed_at")
      .eq("user_id", userId)
      .gte("placed_at", start.toISOString())
      .lt("placed_at", end.toISOString());

    if (usedRes.error) throw usedRes.error;

    const used = (usedRes.data ?? []).reduce((sum: number, row: any) => {
      const s = Number(row?.stake ?? 0);
      return sum + (Number.isFinite(s) ? s : 0);
    }, 0);

    return used;
  };

  const getMonthlyLossUsed = async (userId: string, anchor: Date) => {
    const start = startOfMonthLocal(anchor);
    const end = endOfMonthLocalExclusive(anchor);

    const res = await supabase
      .from("bets")
      .select("profit, result, stake, settled_at, placed_at, status")
      .eq("user_id", userId)
      .or(
        `and(settled_at.gte.${start.toISOString()},settled_at.lt.${end.toISOString()}),and(settled_at.is.null,placed_at.gte.${start.toISOString()},placed_at.lt.${end.toISOString()})`
      );

    if (res.error) throw res.error;

    const used = (res.data ?? []).reduce((sum: number, row: any) => {
      const profit = Number(row?.profit);
      if (Number.isFinite(profit) && profit < 0) return sum + Math.abs(profit);

      const result = String(row?.result ?? "");
      if (result === "loss") {
        const stake = Number(row?.stake ?? 0);
        if (Number.isFinite(stake) && stake > 0) return sum + stake;
      }
      return sum;
    }, 0);

    return used;
  };

  const openBudgetFriction = (budget: number, used: number, thisBet: number) => {
    setBudgetModalData({ budget, used, thisBet });
    setBudgetModalOpen(true);
  };

  const actuallySaveBet = async () => {
    setBusy(true);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      const user = userData.user;
      if (!user) throw new Error("Not logged in.");

      const payload: any = {
        user_id: user.id,
        stake: stakeNum,
        confidence,

        // Memory anchor
        event_label: betSummary.trim(),

        // REQUIRED date
        placed_at: placedAt.toISOString(),

        // Optional details (store null if not selected)
        sport: normalizedSport ?? null,
        bet_type: normalizedBetType ?? null,

        // Optional why tags
        emotion: emotions[0] ?? null,
        emotions: emotions.length ? emotions : [],

        status: "open",
      };

      const { error } = await supabase.from("bets").insert(payload);
      if (error) throw error;

      bump();

      // reset
      setPlacedAt(new Date());
      setStake("");
      setConfidence(null);
      setBetSummary("");
      clearWhy();

      setSport(null);
      setBetType(null);
      setSportOther("");
      setBetTypeOther("");
      setDetailsOpen(false);

      router.replace("/(tabs)/bets" as any);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save bet");
    } finally {
      setBusy(false);
    }
  };

  const continueFromBudgetModal = async () => {
    if (!budgetModalData) return;
    setBudgetModalOpen(false);
    setBudgetModalData(null);
    await actuallySaveBet();
  };

  const validateRequired = () => {
    if (!(placedAt instanceof Date) || Number.isNaN(placedAt.getTime())) {
      Alert.alert("Bet date", "Please select a valid bet date.");
      return false;
    }
    if (!stake || !Number.isFinite(stakeNum) || stakeNum <= 0) {
      Alert.alert("Missing stake", "Enter a valid stake amount.");
      return false;
    }
    if (confidence == null) {
      Alert.alert("Confidence", "Pick a confidence level.");
      return false;
    }
    const s = betSummary.trim();
    if (!s) {
      Alert.alert(
        "Bet summary",
        "Add a quick summary so you’ll remember this when it’s time to settle.\n\nExample: “Chiefs -3 vs Bills”"
      );
      return false;
    }

    // If user opened details and picked "Other", enforce typing
    if (sport === "Other" && detailsOpen && !sportOther.trim()) {
      Alert.alert("Sport", "Please type the sport (or pick a listed one).");
      return false;
    }
    if (betType === "Other" && detailsOpen && !betTypeOther.trim()) {
      Alert.alert("Bet type", "Please type the bet type (or pick a listed one).");
      return false;
    }

    return true;
  };

  const save = async () => {
    Keyboard.dismiss();
    if (busy) return;

    if (!validateRequired()) return;

    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      const user = userData.user;
      if (!user) throw new Error("Not logged in.");

      const enforceWeeklyBudget = isSameLocalWeek(placedAt, new Date());
      const { weeklyBudget, maxBet } = await getGoals(user.id);

      if (maxBet > 0 && stakeNum > maxBet) {
        Alert.alert(
          "Over your max bet size",
          `Max bet: ${money(maxBet)}\nThis bet: ${money(stakeNum)}\n\nLog it anyway?`,
          [
            { text: "Edit", style: "cancel" },
            {
              text: "Log anyway",
              style: "destructive",
              onPress: async () => {
                if (!enforceWeeklyBudget) return actuallySaveBet();

                const used = await getWeeklyUsedForDate(user.id, placedAt);
                const wouldBeUsed = used + stakeNum;

                if (weeklyBudget > 0 && wouldBeUsed > weeklyBudget) {
                  openBudgetFriction(weeklyBudget, used, stakeNum);
                } else {
                  actuallySaveBet();
                }
              },
            },
          ]
        );
        return;
      }

      if (enforceWeeklyBudget && weeklyBudget > 0) {
        const used = await getWeeklyUsedForDate(user.id, placedAt);
        const wouldBeUsed = used + stakeNum;

        if (wouldBeUsed > weeklyBudget) {
          openBudgetFriction(weeklyBudget, used, stakeNum);
          return;
        }
      }

      await actuallySaveBet();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not validate goals");
    }
  };

  const overage = useMemo(() => {
    if (!budgetModalData) return 0;
    const { budget, used, thisBet } = budgetModalData;
    const after = used + thisBet;
    return Math.max(0, after - budget);
  }, [budgetModalData]);

  // Cap warning on focus (unchanged)
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let timeoutId: any;

      const run = async () => {
        timeoutId = setTimeout(() => {
          scrollRef.current?.scrollTo({ y: 0, animated: false });
        }, 0);

        try {
          const { data: userData, error: userErr } = await supabase.auth.getUser();
          if (userErr) throw userErr;
          const user = userData.user;
          if (!user) return;

          const now = new Date();
          const { weeklyBudget, monthlyLossCap } = await getGoals(user.id);

          const [weeklyUsed, monthlyLossUsed] = await Promise.all([
            weeklyBudget > 0 ? getWeeklyUsedForDate(user.id, now) : Promise.resolve(0),
            monthlyLossCap > 0 ? getMonthlyLossUsed(user.id, now) : Promise.resolve(0),
          ]);

          const weeklyOver = weeklyBudget > 0 ? Math.max(0, weeklyUsed - weeklyBudget) : 0;
          const monthlyOver = monthlyLossCap > 0 ? Math.max(0, monthlyLossUsed - monthlyLossCap) : 0;

          if (!alive) return;

          if (weeklyOver > 0 || monthlyOver > 0) {
            setCapWarning({
              weeklyBudget: weeklyBudget > 0 ? weeklyBudget : undefined,
              weeklyUsed: weeklyBudget > 0 ? weeklyUsed : undefined,
              weeklyOver: weeklyOver > 0 ? weeklyOver : undefined,
              monthlyLossCap: monthlyLossCap > 0 ? monthlyLossCap : undefined,
              monthlyLossUsed: monthlyLossCap > 0 ? monthlyLossUsed : undefined,
              monthlyOver: monthlyOver > 0 ? monthlyOver : undefined,
            });
            setCapWarningOpen(true);
          } else {
            setCapWarningOpen(false);
            setCapWarning(null);
          }
        } catch {
          // silent
        }
      };

      run();

      return () => {
        alive = false;
        if (timeoutId) clearTimeout(timeoutId);
      };
    }, [])
  );

  const EmotionGroupBlock = ({ k }: { k: EmotionGroupKey }) => {
    const g = EMOTION_GROUPS[k];
    const expanded = openGroup === k;

    return (
      <View style={{ gap: 10 }}>
        <Pressable
          onPress={() => setOpenGroup(expanded ? null : k)}
          style={{
            backgroundColor: Theme.card,
            borderWidth: 1,
            borderColor: expanded ? Theme.text : Theme.border,
            borderRadius: 14,
            padding: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 14 }}>{g.title}</Text>
            <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 12, marginTop: 2 }}>
              {g.subtitle}
            </Text>
          </View>
          <Text style={{ color: Theme.sub, fontSize: 18, fontWeight: "900" }}>
            {expanded ? "▴" : "▾"}
          </Text>
        </Pressable>

        {expanded ? (
          <View
            style={{
              backgroundColor: Theme.card,
              borderWidth: 1,
              borderColor: Theme.border,
              borderRadius: 14,
              padding: 12,
              gap: 10,
            }}
          >
            <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>
              Pick up to {WHY_MAX}
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {g.items.map((e) => (
                <Chip
                  key={e.value}
                  label={e.label}
                  selected={emotions.includes(e.value as Emotion)}
                  onPress={() => toggleWhy(e.value as Emotion)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  const sportValueLabel = useMemo(() => {
    if (!sport) return "— (optional)";
    if (sport !== "Other") return sport;
    return sportOther.trim() ? `Other: ${sportOther.trim()}` : "Other";
  }, [sport, sportOther]);

  const betTypeValueLabel = useMemo(() => {
    if (!betType) return "— (optional)";
    if (betType !== "Other") return betType;
    return betTypeOther.trim() ? `Other: ${betTypeOther.trim()}` : "Other";
  }, [betType, betTypeOther]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
      {/* Only show SelectModals when values exist; for null, pass a safe placeholder */}
      <SelectModal
        title="Select sport"
        visible={sportOpen}
        options={SPORTS}
        selected={(sport ?? "NFL") as Sport}
        onSelect={(v) => setSport(v)}
        onClose={() => setSportOpen(false)}
      />
      <SelectModal
        title="Select bet type"
        visible={betTypeOpen}
        options={BET_TYPES}
        selected={(betType ?? "Straight / Moneyline") as BetType}
        onSelect={(v) => setBetType(v)}
        onClose={() => setBetTypeOpen(false)}
      />

      {/* Bet date quick modal */}
      <BetDateModal
        visible={betDateModalOpen}
        placedAtLabel={placedAtLabel}
        onClose={() => setBetDateModalOpen(false)}
        onPickQuick={(daysAgo) => setPlacedAtDaysAgo(daysAgo)}
        onPickOther={() => openOtherCalendar()}
      />

      {/* Native calendar */}
      <SheetModal
        visible={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        position="bottom"
        maxHeight={Platform.OS === "ios" ? 360 : 420}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>Pick a date</Text>
          <Pressable onPress={() => setCalendarOpen(false)} hitSlop={10}>
            <Text style={{ color: Theme.sub, fontWeight: "900" }}>Close</Text>
          </Pressable>
        </View>

        <View style={{ height: 10 }} />

        {Platform.OS === "ios" ? (
          <>
            <DateTimePicker
              value={iosCalendarDraft}
              mode="date"
              display="spinner"
              onChange={(_, d) => {
                if (d) setIosCalendarDraft(d);
              }}
              themeVariant="dark"
            />
            <View style={{ height: 10 }} />
            <Button
              title="Use this date"
              onPress={() => {
                applyPickedDate(iosCalendarDraft);
                setCalendarOpen(false);
              }}
            />
          </>
        ) : (
          <DateTimePicker
            value={placedAt}
            mode="date"
            display="calendar"
            onChange={(_, d) => {
              if (d) applyPickedDate(d);
              setCalendarOpen(false);
            }}
          />
        )}
      </SheetModal>

      {/* Cap warning modal */}
      <SheetModal
        visible={capWarningOpen}
        onClose={() => setCapWarningOpen(false)}
        position="center"
        maxHeight="80%"
      >
        <Text style={{ color: Theme.text, fontSize: 18, fontWeight: "900" }}>⚠️ Heads up</Text>

        <View style={{ height: 10 }} />

        <ScrollView keyboardShouldPersistTaps="always">
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>
            {capWarning?.weeklyOver && capWarning?.monthlyOver
              ? "You’re currently over TWO limits:"
              : "You’re currently over one of your limits:"}
          </Text>

          <View style={{ height: 10 }} />

          {capWarning?.weeklyOver ? (
            <View style={{ gap: 4, marginBottom: 12 }}>
              <Text style={{ color: Theme.text, fontWeight: "900" }}>Weekly wager budget exceeded</Text>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                Budget:{" "}
                <Text style={{ color: Theme.text, fontWeight: "900" }}>
                  {money(capWarning.weeklyBudget ?? 0)}
                </Text>
              </Text>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                Used:{" "}
                <Text style={{ color: Theme.text, fontWeight: "900" }}>
                  {money(capWarning.weeklyUsed ?? 0)}
                </Text>
              </Text>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                Over by:{" "}
                <Text style={{ color: Theme.text, fontWeight: "900" }}>
                  {money(capWarning.weeklyOver ?? 0)}
                </Text>
              </Text>
            </View>
          ) : null}

          {capWarning?.monthlyOver ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: Theme.text, fontWeight: "900" }}>Monthly loss cap exceeded</Text>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                Cap:{" "}
                <Text style={{ color: Theme.text, fontWeight: "900" }}>
                  {money(capWarning.monthlyLossCap ?? 0)}
                </Text>
              </Text>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                Losses this month:{" "}
                <Text style={{ color: Theme.text, fontWeight: "900" }}>
                  {money(capWarning.monthlyLossUsed ?? 0)}
                </Text>
              </Text>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                Over by:{" "}
                <Text style={{ color: Theme.text, fontWeight: "900" }}>
                  {money(capWarning.monthlyOver ?? 0)}
                </Text>
              </Text>
            </View>
          ) : null}

          <View style={{ height: 12 }} />
          <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "700" }}>
            Tip: If you’re logging anyway, consider lowering your stake or taking a short break.
          </Text>
        </ScrollView>

        <View style={{ height: 14 }} />

        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title="Proceed" onPress={() => setCapWarningOpen(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="View goals"
              onPress={() => {
                setCapWarningOpen(false);
                router.push("/(tabs)/goals" as any);
              }}
            />
          </View>
        </View>
      </SheetModal>

      {/* Weekly budget friction modal */}
      <SheetModal
        visible={budgetModalOpen}
        onClose={() => setBudgetModalOpen(false)}
        position="bottom"
        maxHeight="80%"
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
          <Text style={{ color: Theme.text, fontSize: 18, fontWeight: "900", flex: 1 }}>
            ⚠️ You’re about to exceed your weekly budget
          </Text>
          <Pressable onPress={() => setBudgetModalOpen(false)} hitSlop={10}>
            <Text style={{ color: Theme.sub, fontWeight: "900" }}>Close</Text>
          </Pressable>
        </View>

        <View style={{ height: 10 }} />

        <ScrollView keyboardShouldPersistTaps="always">
          {budgetModalData ? (
            <View style={{ gap: 6 }}>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                Budget:{" "}
                <Text style={{ color: Theme.text, fontWeight: "900" }}>
                  {money(budgetModalData.budget)}
                </Text>
              </Text>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                Used:{" "}
                <Text style={{ color: Theme.text, fontWeight: "900" }}>
                  {money(budgetModalData.used)}
                </Text>
              </Text>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                This bet:{" "}
                <Text style={{ color: Theme.text, fontWeight: "900" }}>
                  {money(budgetModalData.thisBet)}
                </Text>
              </Text>

              <View style={{ height: 8 }} />

              <Text style={{ color: Theme.sub, fontWeight: "800" }}>
                Overage after logging:{" "}
                <Text style={{ color: Theme.text, fontWeight: "900" }}>{money(overage)}</Text>
              </Text>
            </View>
          ) : null}

          <View style={{ height: 12 }} />
          <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "700" }}>
            Tip: Consider lowering your stake or taking a quick break.
          </Text>
        </ScrollView>

        <View style={{ height: 14 }} />

        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Lower stake"
              onPress={() => {
                setBudgetModalOpen(false);
                setTimeout(() => {
                  scrollToStakeWithOffset(true);
                  setTimeout(() => stakeRef.current?.focus?.(), 120);
                }, 60);
              }}
              disabled={busy}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" onPress={() => setBudgetModalOpen(false)} disabled={busy} />
          </View>
        </View>

        <View style={{ height: 10 }} />
        <Button title="Log anyway" onPress={continueFromBudgetModal} disabled={busy} />
      </SheetModal>

      {/* --------- Main form --------- */}
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
      >
        <Text style={{ color: Theme.text, fontSize: 24, fontWeight: "900" }}>Log a Bet</Text>

        {/* Date (required, top) */}
        <SelectRow label="Bet date (required)" value={placedAtLabel} onPress={() => setBetDateModalOpen(true)} />

        {/* Stake (required) */}
        <View
          style={{ gap: 6 }}
          onLayout={(e) => {
            stakeYRef.current = e.nativeEvent.layout.y;
          }}
        >
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>Stake (required)</Text>

          <View
            style={{
              backgroundColor: Theme.card,
              borderWidth: 1,
              borderColor: Theme.border,
              borderRadius: 14,
              paddingHorizontal: 12,
              paddingVertical: 10,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>$</Text>

            <TextInput
              ref={(r) => {
                stakeRef.current = r;
              }}
              value={stake}
              onChangeText={(t) => setStake(t.replace(/[^0-9.]/g, ""))}
              keyboardType="numeric"
              returnKeyType="done" // ✅ requested
              blurOnSubmit
              onSubmitEditing={() => Keyboard.dismiss()}
              style={{
                flex: 1,
                color: Theme.text,
                fontSize: 16,
                fontWeight: "900",
                padding: 0,
                margin: 0,
              }}
              placeholder="0"
              placeholderTextColor={Theme.sub}
            />
          </View>
        </View>

        {/* Confidence (required) */}
        <View style={{ gap: 6 }}>
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>Confidence (required)</Text>
          <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 12 }}>
            Current:{" "}
            <Text style={{ color: Theme.text, fontWeight: "900" }}>
              {confidence == null ? "— (pick one)" : `${confidenceLabel}`}
            </Text>
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <ConfidencePill
            label="Very low"
            selected={confidence === 1}
            onPress={() => setConfidence(1)}
            flexGrow={1.35}
          />
          <ConfidencePill label="Low" selected={confidence === 2} onPress={() => setConfidence(2)} flexGrow={0.95} />
          <ConfidencePill label="Mid" selected={confidence === 3} onPress={() => setConfidence(3)} flexGrow={0.85} />
          <ConfidencePill
            label="High"
            selected={confidence === 4}
            onPress={() => setConfidence(4)}
            flexGrow={0.95}
          />
          <ConfidencePill
            label="Very high"
            selected={confidence === 5}
            onPress={() => setConfidence(5)}
            flexGrow={1.35}
          />
        </View>

        {/* Bet summary (required memory anchor) */}
        <View style={{ gap: 8 }}>
          <SmallHeader
            title="What was this bet? (required)"
            subtitle="Write it how you’d remember it when it’s time to settle."
          />

          <View
            style={{
              backgroundColor: Theme.card,
              borderWidth: 1,
              borderColor: Theme.border,
              borderRadius: 14,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <TextInput
              ref={summaryRef}
              value={betSummary}
              onChangeText={setBetSummary}
              placeholder='e.g., "Chiefs -3 vs Bills" or "Parlay: Lakers + Over"'
              placeholderTextColor={Theme.sub}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              style={{
                color: Theme.text,
                fontSize: 15,
                fontWeight: "800",
                padding: 0,
                margin: 0,
              }}
            />
          </View>
        </View>

        {/* Why (optional) */}
        <View style={{ gap: 10 }}>
          <SmallHeader
            title="Be honest — what’s driving this? (optional)"
            subtitle="Pick at least one if you can — this powers your insights."
          />

          {emotions.length ? (
            <View
              style={{
                backgroundColor: Theme.card,
                borderWidth: 1,
                borderColor: Theme.border,
                borderRadius: 14,
                padding: 12,
                gap: 6,
              }}
            >
              <Text style={{ color: Theme.sub, fontWeight: "800", fontSize: 12 }}>Selected</Text>
              <Text style={{ color: Theme.text, fontWeight: "900" }}>
                {selectedWhyLabels.join(", ")}
              </Text>

              <View style={{ height: 6 }} />
              <Button title="Clear" onPress={clearWhy} />
            </View>
          ) : null}

          {/* Inline expand per group */}
          <View style={{ gap: 12 }}>
            <EmotionGroupBlock k="strategic" />
            <EmotionGroupBlock k="recreational" />
            <EmotionGroupBlock k="situational" />
            <EmotionGroupBlock k="reactive" />
          </View>
        </View>

        {/* Details (optional, collapsible) */}
        <Pressable
          onPress={() => setDetailsOpen((v) => !v)}
          style={{
            backgroundColor: Theme.card,
            borderWidth: 1,
            borderColor: Theme.border,
            borderRadius: 14,
            paddingVertical: 12,
            paddingHorizontal: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ color: Theme.text, fontWeight: "900" }}>Add details (optional)</Text>
            <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 12, marginTop: 2 }}>
              Sport + bet type helps organize your history.
            </Text>
          </View>
          <Text style={{ color: Theme.sub, fontSize: 18, fontWeight: "900" }}>
            {detailsOpen ? "▴" : "▾"}
          </Text>
        </Pressable>

        {detailsOpen ? (
          <View style={{ gap: 12 }}>
            <SelectRow label="Sport" value={sportValueLabel} onPress={() => setSportOpen(true)} />
            {sport === "Other" && (
              <Field
                label="Sport (Other)"
                value={sportOther}
                onChangeText={setSportOther}
                placeholder="e.g., Esports, Table Tennis"
                returnKeyType="next"
                onSubmitEditing={() => setBetTypeOpen(true)}
              />
            )}

            <SelectRow label="Bet Type" value={betTypeValueLabel} onPress={() => setBetTypeOpen(true)} />
            {betType === "Other" && (
              <Field
                label="Bet Type (Other)"
                value={betTypeOther}
                onChangeText={setBetTypeOther}
                placeholder="e.g., Teaser"
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
              />
            )}
          </View>
        ) : null}

        <Button title={busy ? "Saving…" : "Log Bet"} onPress={save} disabled={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 16,
  },
  sheet: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
});