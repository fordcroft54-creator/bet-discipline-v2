import { router } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { useAppStore } from "../store/useAppStore";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Field } from "../ui/Field";
import { Theme } from "../ui/Theme";

/**
 * NEW FRICTION (weekly budget overage):
 * ✅ If logging this bet would exceed weekly wager budget:
 *    - show a modal: "You're about to exceed your weekly budget"
 *    - user must either Lower Stake (focus stake field), Cancel, or Continue
 *    - if Continue, require a "What's driving this bet?" selection (single)
 *    - THEN save bet
 *
 * Notes:
 * - This assumes your goals table has `weekly_wager_budget` (number).
 * - "Used this week" is computed from bets in the current week (open+settled) using `stake`.
 * - Uses local timezone week boundaries (Mon–Sun).
 * - Keeps your existing max_bet override alert.
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
  // 🔴 High risk
  { label: "😐 Bored", value: "bored" },
  { label: "😤 Chasing losses", value: "chasing_losses" },
  { label: "😡 Tilted / frustrated", value: "tilted" },
  { label: "😰 Stressed", value: "stressed" },
  { label: "🍺 Drinking", value: "drinking" },
  { label: "⚡ Impulsive", value: "impulsive" },

  // 🟡 Neutral / mixed
  { label: "🔁 Habit / routine", value: "habit" },
  { label: "👯 Social / with friends", value: "social" },
  { label: "🎉 Confident", value: "confident" },
  { label: "🙂 Just for fun", value: "fun" },

  // 🟢 Controlled
  { label: "🧠 Pre-planned", value: "pre_planned" },
  { label: "💸 Within budget", value: "within_budget" },
] as const;

type Sport = (typeof SPORTS)[number];
type BetType = (typeof BET_TYPES)[number];
type Emotion = (typeof EMOTIONS)[number]["value"];

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
  // Monday 00:00 local time
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // move to Monday
  x.setDate(x.getDate() + diff);
  return x;
}

function endOfWeekLocalExclusive(d: Date) {
  const s = startOfWeekLocal(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 7);
  return e; // exclusive upper bound
}

export default function LogBetScreen() {
  const bump = useAppStore((s) => s.bump);

  const [sport, setSport] = useState<Sport>("NFL");
  const [betType, setBetType] = useState<BetType>("Straight / Moneyline");

  const [sportOther, setSportOther] = useState("");
  const [betTypeOther, setBetTypeOther] = useState("");

  const [stake, setStake] = useState("");
  const [eventLabel, setEventLabel] = useState("");

  // multi-select emotions (kept as-is for your model)
  const [emotions, setEmotions] = useState<Emotion[]>(["bored"]);
  const EMOTION_MAX = 3;

  // NEW: friction "driver" (single required when over budget)
  const [budgetDriver, setBudgetDriver] = useState<Emotion | null>(null);

  // confidence where 1 = low, 5 = high
  const [confidence, setConfidence] = useState<1 | 2 | 3 | 4 | 5>(3);

  const [busy, setBusy] = useState(false);

  const [sportOpen, setSportOpen] = useState(false);
  const [betTypeOpen, setBetTypeOpen] = useState(false);

  // NEW: budget friction modal state
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetModalData, setBudgetModalData] = useState<{
    budget: number;
    used: number;
    thisBet: number;
  } | null>(null);

  const stakeNum = useMemo(() => Number(stake), [stake]);

  const stakeRef = useRef<any>(null);
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

      // don't allow empty selection
      if (has && prev.length === 1) return prev;

      if (has) return prev.filter((x) => x !== v);

      if (prev.length >= EMOTION_MAX) {
        Alert.alert("Too many emotions", `Pick up to ${EMOTION_MAX}.`);
        return prev;
      }

      return [...prev, v];
    });
  };

  const confidenceLabel = useMemo(() => {
    if (confidence <= 2) return "Low";
    if (confidence === 3) return "Medium";
    return "High";
  }, [confidence]);

  // --------- actual insert ----------
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

        // Backward-compatible single field:
        emotion: emotions[0],

        // Requires `emotions` column (text[] or jsonb)
        emotions,

        status: "open",

        // Requires `confidence` column (smallint)
        confidence,

        // OPTIONAL: if you add a column later, this becomes very valuable analytics.
        // budget_driver: budgetDriver,
      };

      const { error } = await supabase.from("bets").insert(payload);
      if (error) throw error;

      bump();

      // reset
      setStake("");
      setEventLabel("");
      setSport("NFL");
      setBetType("Straight / Moneyline");
      setSportOther("");
      setBetTypeOther("");
      setEmotions(["bored"]);
      setBudgetDriver(null);
      setConfidence(3);

      router.replace("/(tabs)/bets" as any);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save bet");
    } finally {
      setBusy(false);
    }
  };

  // NEW: fetch goals + weekly used stake
  const getWeeklyBudgetAndUsed = async (userId: string) => {
    // 1) weekly budget from goals
    const g = await supabase
      .from("goals")
      .select("weekly_budget, max_bet")
      .eq("user_id", userId)
      .maybeSingle();

    if (g.error) throw g.error;

    const weeklyBudget = Number((g.data as any)?.weekly_budget ?? 0);
    const maxBet = Number((g.data as any)?.max_bet ?? 0);

    // 2) used this week (sum stake)
    const now = new Date();
    const start = startOfWeekLocal(now);
    const end = endOfWeekLocalExclusive(now);

    const usedRes = await supabase
      .from("bets")
      .select("stake, created_at")
      .eq("user_id", userId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());

    if (usedRes.error) throw usedRes.error;

    const used = (usedRes.data ?? []).reduce((sum: number, row: any) => {
      const s = Number(row?.stake ?? 0);
      return sum + (Number.isFinite(s) ? s : 0);
    }, 0);

    return { weeklyBudget, used, maxBet };
  };

  // NEW: show friction modal
  const openBudgetFriction = (budget: number, used: number, thisBet: number) => {
    setBudgetDriver(null); // require fresh selection each time
    setBudgetModalData({ budget, used, thisBet });
    setBudgetModalOpen(true);
  };

  const continueFromBudgetModal = async () => {
    if (!budgetModalData) return;

    // require driver selection
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

    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      const user = userData.user;
      if (!user) throw new Error("Not logged in.");

      const { weeklyBudget, used, maxBet } = await getWeeklyBudgetAndUsed(user.id);

      // 1) EXISTING: max bet size override (keep this first, because it’s a clean simple check)
      if (maxBet > 0 && stakeNum > maxBet) {
        Alert.alert(
          "Over your max bet size",
          `Max bet: ${money(maxBet)}\nThis bet: ${money(stakeNum)}\n\nLog it anyway?`,
          [
            { text: "Edit", style: "cancel" },
            {
              text: "Log anyway",
              style: "destructive",
              onPress: () => {
                // after max-bet override, still check weekly budget friction
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

      // 2) NEW: weekly budget friction
      const wouldBeUsed = used + stakeNum;
      if (weeklyBudget > 0 && wouldBeUsed > weeklyBudget) {
        openBudgetFriction(weeklyBudget, used, stakeNum);
        return;
      }

      // Otherwise save normally
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

      {/* NEW: Budget friction modal */}
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
                    // focus stake input immediately so it feels like “edit”
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

            <Button
              title="Log anyway"
              onPress={continueFromBudgetModal}
              disabled={busy}
            />

            <View style={{ height: 6 }} />
            <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "700" }}>
              Tip: If this is a “chasing losses” moment, try lowering stake or taking a
              10-minute break.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 14 }}
      >
        <Text style={{ color: Theme.text, fontSize: 24, fontWeight: "900" }}>
          Log a Bet
        </Text>

        {/* SPORT */}
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

        {/* BET TYPE */}
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

        {/* STAKE */}
        <Field
          ref={stakeRef}
          label="Stake Amount"
          value={stake}
          onChangeText={setStake}
          keyboardType="numeric"
          placeholder="e.g., 50"
          returnKeyType="next"
          onSubmitEditing={() => eventRef.current?.focus?.()}
        />

        {/* EVENT (ENTER SHOULD ONLY DISMISS KEYBOARD) */}
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

        {/* EMOTIONS (multi-select) */}
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
            Confidence (1 = Low, 5 = High)
          </Text>
          <Text style={{ color: Theme.sub, fontWeight: "700", fontSize: 12 }}>
            Current:{" "}
            <Text style={{ color: Theme.text, fontWeight: "900" }}>
              {confidence} ({confidenceLabel})
            </Text>
          </Text>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <Chip
              key={n}
              label={n === 1 ? "1 · Low" : n === 5 ? "5 · High" : `${n}`}
              selected={confidence === n}
              onPress={() => setConfidence(n)}
            />
          ))}
        </View>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginTop: -6,
            paddingHorizontal: 4,
          }}
        >
          <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "800" }}>
            Low
          </Text>
          <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "800" }}>
            High
          </Text>
        </View>

        <Button title={busy ? "Saving…" : "Log Bet"} onPress={save} disabled={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}