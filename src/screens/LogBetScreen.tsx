import { useFocusEffect, router } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
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
import { useAppStore } from "../store/useAppStore";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Field } from "../ui/Field";
import { Theme } from "../ui/Theme";

/**
 * Updates:
 * ✅ Keeps default bet date = Today
 * ✅ Adds quick chips: Today / Yesterday / 2 days ago / 3 days ago / Other
 * ✅ "Other" opens native calendar picker
 *    - iOS: inline picker inside a bottom-sheet modal (aligned w/ your other selectors)
 *    - Android: native picker modal
 * ✅ Stores placed_at as NOW time if Today, otherwise stores at 12:00 local time (TZ safe)
 * ✅ Weekly budget is ONLY enforced for bets in the CURRENT week (not backdated bets)
 * ✅ Confidence labels: 1 = Very low, 5 = Very high
 * ✅ NEW: Confidence buttons are custom oval pills (not Chip), with 1 & 5 wider,
 *         and everything stays on ONE line on an average iPhone.
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

const EMOTIONS = [
  { label: "😐 Bored", value: "bored" },
  { label: "😤 Chasing losses", value: "chasing_losses" },
  { label: "😡 Tilted / frustrated", value: "tilted" },
  { label: "😰 Stressed", value: "stressed" },
  { label: "🍺 Drinking", value: "drinking" },
  { label: "⚡ Impulsive", value: "impulsive" },

  { label: "🔁 Habit / routine", value: "habit" },
  { label: "👯 Social / with friends", value: "social" },
  { label: "🎉 Confident", value: "confident" },
  { label: "🙂 Just for fun", value: "fun" },

  { label: "🧠 Pre-planned", value: "pre_planned" },
  { label: "💸 Within budget", value: "within_budget" },
] as const;

type Sport = (typeof SPORTS)[number];
type BetType = (typeof BET_TYPES)[number];
type Emotion = (typeof EMOTIONS)[number]["value"];
type Confidence = 1 | 2 | 3 | 4 | 5;

const EMOTION_LABEL_BY_VALUE: Record<Emotion, string> = EMOTIONS.reduce(
  (acc, e) => {
    acc[e.value as Emotion] = e.label;
    return acc;
  },
  {} as Record<Emotion, string>
);

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
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
            padding: 14,
            borderWidth: 1,
            borderColor: Theme.border,
            maxHeight: "70%",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ color: Theme.text, fontSize: 16, fontWeight: "900" }}>
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={{ color: Theme.sub, fontWeight: "800" }}>Close</Text>
            </Pressable>
          </View>

          <View style={{ height: 10 }} />

          <ScrollView keyboardShouldPersistTaps="handled">
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
        </Pressable>
      </Pressable>
    </Modal>
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
        <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "800" }}>
          {label}
        </Text>
        <Text
          style={{
            color: Theme.text,
            fontSize: 16,
            fontWeight: "900",
            marginTop: 2,
          }}
        >
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

/** ✅ new helper: treat "weekly budget" as THIS week's budget, not historical weeks */
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
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? Theme.text : Theme.border,
        backgroundColor: Theme.card,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{
          color: Theme.text,
          fontWeight: "900",
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function LogBetScreen() {
  const bump = useAppStore((s) => s.bump);

  const scrollRef = useRef<ScrollView>(null);
  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      }, 0);
      return () => clearTimeout(t);
    }, [])
  );

  const [sport, setSport] = useState<Sport>("NFL");
  const [betType, setBetType] = useState<BetType>("Straight / Moneyline");

  const [sportOther, setSportOther] = useState("");
  const [betTypeOther, setBetTypeOther] = useState("");

  const [stake, setStake] = useState("");
  const [eventLabel, setEventLabel] = useState("");

  const [placedAt, setPlacedAt] = useState<Date>(() => new Date());
  const [betDateModalOpen, setBetDateModalOpen] = useState(false);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [iosCalendarDraft, setIosCalendarDraft] = useState<Date>(() => new Date());

  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const EMOTION_MAX = 3;

  const [budgetDriver, setBudgetDriver] = useState<Emotion | null>(null);

  const [confidence, setConfidence] = useState<Confidence | null>(null);

  const [busy, setBusy] = useState(false);

  const [sportOpen, setSportOpen] = useState(false);
  const [betTypeOpen, setBetTypeOpen] = useState(false);

  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetModalData, setBudgetModalData] = useState<{
    budget: number;
    used: number;
    thisBet: number;
  } | null>(null);

  const stakeNum = useMemo(() => Number(stake), [stake]);

  const stakeRef = useRef<TextInput | null>(null);
  const eventRef = useRef<any>(null);

  const normalizedSport = useMemo(() => {
    if (sport !== "Other") return sport;
    const v = sportOther.trim();
    return v ? v : "Other";
  }, [sport, sportOther]);

  const normalizedBetType = useMemo(() => {
    if (betType !== "Other") return betType;
    const v = betTypeOther.trim();
    return v ? v : "Other";
  }, [betType, betTypeOther]);

  const selectedEmotionLabels = useMemo(() => {
    return emotions.map((v) => EMOTION_LABEL_BY_VALUE[v] ?? v);
  }, [emotions]);

  const toggleEmotion = (v: Emotion) => {
    setEmotions((prev) => {
      const has = prev.includes(v);
      if (has) return prev.filter((x) => x !== v);

      if (prev.length >= EMOTION_MAX) {
        Alert.alert("Too many emotions", `Pick up to ${EMOTION_MAX}.`);
        return prev;
      }
      return [...prev, v];
    });
  };

  const confidenceLabel = useMemo(() => {
    if (confidence == null) return "—";
    if (confidence === 1) return "Very low";
    if (confidence === 2) return "Low";
    if (confidence === 3) return "Medium";
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

    if (Platform.OS === "ios") {
      setIosCalendarDraft(placedAt);
      setCalendarOpen(true);
    } else {
      setCalendarOpen(true);
    }
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
        sport: normalizedSport,
        bet_type: normalizedBetType,
        stake: stakeNum,
        event_label: eventLabel.trim() ? eventLabel.trim() : null,
        placed_at: placedAt.toISOString(),

        emotion: emotions[0] ?? null,
        emotions,

        status: "open",
        confidence,
      };

      const { error } = await supabase.from("bets").insert(payload);
      if (error) throw error;

      bump();

      setStake("");
      setEventLabel("");
      setSport("NFL");
      setBetType("Straight / Moneyline");
      setSportOther("");
      setBetTypeOther("");
      setEmotions([]);
      setBudgetDriver(null);
      setConfidence(null);

      setPlacedAt(new Date());

      router.replace("/(tabs)/bets" as any);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save bet");
    } finally {
      setBusy(false);
    }
  };

  const getGoals = async (userId: string) => {
    const g = await supabase
      .from("goals")
      .select("weekly_budget, max_bet")
      .eq("user_id", userId)
      .maybeSingle();

    if (g.error) throw g.error;

    const weeklyBudget = Number((g.data as any)?.weekly_budget ?? 0);
    const maxBet = Number((g.data as any)?.max_bet ?? 0);
    return { weeklyBudget, maxBet };
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

  const openBudgetFriction = (budget: number, used: number, thisBet: number) => {
    setBudgetDriver(null);
    setBudgetModalData({ budget, used, thisBet });
    setBudgetModalOpen(true);
  };

  const continueFromBudgetModal = async () => {
    if (!budgetModalData) return;

    if (!budgetDriver) {
      Alert.alert("Quick check-in", "What’s driving this bet right now?");
      return;
    }

    setBudgetModalOpen(false);
    setBudgetModalData(null);

    await actuallySaveBet();
  };

  const save = async () => {
    Keyboard.dismiss();
    if (busy) return;

    if (!stake || !Number.isFinite(stakeNum) || stakeNum <= 0) {
      return Alert.alert("Missing stake", "Enter a valid stake amount.");
    }

    if (sport === "Other" && !sportOther.trim()) {
      return Alert.alert("Sport", "Please type the sport (or pick a listed one).");
    }

    if (betType === "Other" && !betTypeOther.trim()) {
      return Alert.alert("Bet type", "Please type the bet type (or pick a listed one).");
    }

    if (!emotions.length) {
      return Alert.alert("Emotion", "Pick at least 1 emotion.");
    }

    if (confidence == null) {
      return Alert.alert("Confidence", "Pick a confidence level (1–5).");
    }

    if (!(placedAt instanceof Date) || Number.isNaN(placedAt.getTime())) {
      return Alert.alert("Bet date", "Please select a valid bet date.");
    }

    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      const user = userData.user;
      if (!user) throw new Error("Not logged in.");

      // ✅ ONLY enforce weekly budget if the bet date is in the current week
      const enforceWeeklyBudget = isSameLocalWeek(placedAt, new Date());

      const { weeklyBudget, maxBet } = await getGoals(user.id);

      // Max bet applies regardless of date (change if you want)
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
                // If we're not enforcing weekly budget (backdated bet), just save.
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

      // ✅ Weekly budget friction ONLY for current-week bets
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
      <SelectModal
        title="Select sport"
        visible={sportOpen}
        options={SPORTS}
        selected={sport}
        onSelect={setSport}
        onClose={() => setSportOpen(false)}
      />
      <SelectModal
        title="Select bet type"
        visible={betTypeOpen}
        options={BET_TYPES}
        selected={betType}
        onSelect={setBetType}
        onClose={() => setBetTypeOpen(false)}
      />

      {/* Bet date quick-select modal (chips) */}
      <Modal
        visible={betDateModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBetDateModalOpen(false)}
      >
        <Pressable
          onPress={() => setBetDateModalOpen(false)}
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
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: Theme.text, fontSize: 16, fontWeight: "900" }}>
                Bet date (when you placed it)
              </Text>
              <Pressable onPress={() => setBetDateModalOpen(false)} hitSlop={10}>
                <Text style={{ color: Theme.sub, fontWeight: "800" }}>Close</Text>
              </Pressable>
            </View>

            <View style={{ height: 10 }} />

            <Text style={{ color: Theme.sub, fontWeight: "800" }}>Quick picks</Text>
            <View style={{ height: 10 }} />

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Chip
                label="Today"
                selected={sameLocalDay(placedAt, new Date())}
                onPress={() => {
                  setPlacedAtDaysAgo(0);
                  setBetDateModalOpen(false);
                }}
              />
              <Chip
                label="Yesterday"
                selected={(() => {
                  const n = new Date();
                  n.setDate(n.getDate() - 1);
                  return sameLocalDay(placedAt, n);
                })()}
                onPress={() => {
                  setPlacedAtDaysAgo(1);
                  setBetDateModalOpen(false);
                }}
              />
              <Chip
                label="2 days ago"
                selected={false}
                onPress={() => {
                  setPlacedAtDaysAgo(2);
                  setBetDateModalOpen(false);
                }}
              />
              <Chip
                label="3 days ago"
                selected={false}
                onPress={() => {
                  setPlacedAtDaysAgo(3);
                  setBetDateModalOpen(false);
                }}
              />
              <Chip label="Other…" selected={false} onPress={openOtherCalendar} />
            </View>

            <View style={{ height: 10 }} />
            <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "700" }}>
              Past dates are saved at midday to avoid timezone edge cases.
            </Text>
            <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "700", marginTop: 6 }}>
              Weekly budget warnings apply only to bets dated in the current week.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      {/* iOS calendar modal (bottom-sheet, aligned) */}
      <Modal
        visible={Platform.OS === "ios" && calendarOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCalendarOpen(false)}
      >
        <Pressable
          onPress={() => setCalendarOpen(false)}
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
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: Theme.text, fontSize: 16, fontWeight: "900" }}>
                Pick a date
              </Text>
              <Pressable onPress={() => setCalendarOpen(false)} hitSlop={10}>
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
                value={iosCalendarDraft}
                mode="date"
                display="inline"
                onChange={(_event, selected) => {
                  if (!selected) return;
                  setIosCalendarDraft(selected);
                }}
              />
            </View>

            <View style={{ height: 12 }} />

            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" onPress={() => setCalendarOpen(false)} disabled={busy} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Apply"
                  onPress={() => {
                    applyPickedDate(iosCalendarDraft);
                    setCalendarOpen(false);
                  }}
                  disabled={busy}
                />
              </View>
            </View>

            <View style={{ height: 8 }} />
            <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "700" }}>
              Past dates are saved at midday to avoid timezone edge cases.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Android native date picker */}
      {Platform.OS === "android" && calendarOpen && (
        <DateTimePicker
          value={placedAt}
          mode="date"
          display="default"
          onChange={(_event, selected) => {
            setCalendarOpen(false);
            if (!selected) return;
            applyPickedDate(selected);
          }}
        />
      )}

      {/* Budget friction modal */}
      <Modal
        visible={budgetModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBudgetModalOpen(false)}
      >
        <Pressable
          onPress={() => setBudgetModalOpen(false)}
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
              ⚠️ You’re about to exceed your weekly budget
            </Text>

            <View style={{ height: 10 }} />

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
                  <Text style={{ color: Theme.text, fontWeight: "900" }}>
                    {money(overage)}
                  </Text>
                </Text>
              </View>
            ) : null}

            <View style={{ height: 14 }} />

            <Text style={{ color: Theme.sub, fontWeight: "800" }}>
              What’s driving this bet right now?
            </Text>

            <View style={{ height: 10 }} />

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {EMOTIONS.slice(0, 10).map((e) => (
                <Chip
                  key={e.value}
                  label={e.label}
                  selected={budgetDriver === e.value}
                  onPress={() => setBudgetDriver(e.value)}
                />
              ))}
            </View>

            <View style={{ height: 14 }} />

            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Lower stake"
                  onPress={() => {
                    setBudgetModalOpen(false);
                    setTimeout(() => stakeRef.current?.focus?.(), 50);
                  }}
                  disabled={busy}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Button
                  title="Cancel"
                  onPress={() => setBudgetModalOpen(false)}
                  disabled={busy}
                />
              </View>
            </View>

            <View style={{ height: 10 }} />

            <Button title="Log anyway" onPress={continueFromBudgetModal} disabled={busy} />

            <View style={{ height: 6 }} />
            <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "700" }}>
              Tip: If this is a “chasing losses” moment, try lowering stake or taking a 10-minute
              break.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 14 }}
      >
        <Text style={{ color: Theme.text, fontSize: 24, fontWeight: "900" }}>Log a Bet</Text>

        <SelectRow
          label="Bet date"
          value={placedAtLabel}
          onPress={() => setBetDateModalOpen(true)}
        />

        <SelectRow
          label="Sport"
          value={
            sport === "Other"
              ? sportOther.trim()
                ? `Other: ${sportOther.trim()}`
                : "Other"
              : sport
          }
          onPress={() => setSportOpen(true)}
        />
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

        <SelectRow
          label="Bet Type"
          value={
            betType === "Other"
              ? betTypeOther.trim()
                ? `Other: ${betTypeOther.trim()}`
                : "Other"
              : betType
          }
          onPress={() => setBetTypeOpen(true)}
        />
        {betType === "Other" && (
          <Field
            label="Bet Type (Other)"
            value={betTypeOther}
            onChangeText={setBetTypeOther}
            placeholder="e.g., Teaser"
            returnKeyType="next"
            onSubmitEditing={() => stakeRef.current?.focus?.()}
          />
        )}

        <View style={{ gap: 6 }}>
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>Stake Amount</Text>

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
              returnKeyType="next"
              onSubmitEditing={() => eventRef.current?.focus?.()}
              style={{
                flex: 1,
                color: Theme.text,
                fontSize: 16,
                fontWeight: "800",
                padding: 0,
                margin: 0,
              }}
            />
          </View>
        </View>

        <Field
          ref={eventRef}
          label="Game / Event (optional)"
          value={eventLabel}
          onChangeText={setEventLabel}
          placeholder="e.g., Hawks vs Heat"
          returnKeyType="done"
          blurOnSubmit
          onSubmitEditing={() => Keyboard.dismiss()}
        />

        <View style={{ gap: 6 }}>
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>
            How are you feeling? (pick up to {EMOTION_MAX})
          </Text>
          <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 12 }}>
            Selected:{" "}
            <Text style={{ color: Theme.text, fontWeight: "900" }}>
              {selectedEmotionLabels.length ? selectedEmotionLabels.join(", ") : "—"}
            </Text>
          </Text>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {EMOTIONS.map((e) => (
            <Chip
              key={e.value}
              label={e.label}
              selected={emotions.includes(e.value)}
              onPress={() => toggleEmotion(e.value)}
            />
          ))}
        </View>

        {/* CONFIDENCE */}
        <View style={{ gap: 6 }}>
          <Text style={{ color: Theme.sub, fontWeight: "800" }}>
            Confidence (1 = Very low, 5 = Very high)
          </Text>
          <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 12 }}>
            Current:{" "}
            <Text style={{ color: Theme.text, fontWeight: "900" }}>
              {confidence == null ? "— (pick one)" : `${confidence} (${confidenceLabel})`}
            </Text>
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <ConfidencePill
            label="1 · Very low"
            selected={confidence === 1}
            onPress={() => setConfidence(1)}
            flexGrow={1.55}
          />
          <ConfidencePill
            label="2"
            selected={confidence === 2}
            onPress={() => setConfidence(2)}
            flexGrow={0.75}
          />
          <ConfidencePill
            label="3"
            selected={confidence === 3}
            onPress={() => setConfidence(3)}
            flexGrow={0.75}
          />
          <ConfidencePill
            label="4"
            selected={confidence === 4}
            onPress={() => setConfidence(4)}
            flexGrow={0.75}
          />
          <ConfidencePill
            label="5 · Very high"
            selected={confidence === 5}
            onPress={() => setConfidence(5)}
            flexGrow={1.55}
          />
        </View>

        <Button title={busy ? "Saving…" : "Log Bet"} onPress={save} disabled={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}