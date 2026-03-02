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
import { supabase } from "../lib/supabase";
import { Theme } from "../ui/Theme";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";

/**
 * BetsScreen (FULL UPDATED)
 * ✅ Uses placed_at (actual bet date) for sorting + display (falls back to created_at)
 * ✅ Edit modal touch fixed so Sport/Bet Type are clickable (Android-safe)
 * ✅ Pickers still touch + scroll safe
 * ✅ Confidence labels match Log Bet:
 *    1=Very low, 2=Low, 3=Medium, 4=High, 5=Very high
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

  confidence?: number | null; // 1..5
};

const SPORTS = [
  "NFL",
  "NBA",
  "MLB",
  "NHL",
  "College Football",
  "College Basketball",
  "Soccer",
  "Tennis",
  "Golf",
  "UFC/MMA",
  "Other",
] as const;

const BET_TYPES = [
  "Moneyline",
  "Against Spread",
  "Over Under",
  "Prop Bet",
  "Parlay",
  "Pick 'Em",
  "Other",
] as const;

const EMOTIONS: { label: string; value: string }[] = [
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
];

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

function formatDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** ✅ Matches Log Bet labels exactly */
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

export default function BetsScreen() {
  const router = useRouter();
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

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

  const inputStyles = useMemo(
    () => ({
      container: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        backgroundColor: Theme.bg,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: Theme.border,
        paddingHorizontal: 12,
        paddingVertical: 10,
      },
      input: {
        flex: 1,
        color: Theme.text,
        fontWeight: "800" as const,
        fontSize: 16,
        paddingVertical: 0,
      },
      label: {
        color: Theme.sub,
        fontWeight: "900" as const,
        fontSize: 12,
      },
      dollar: {
        color: Theme.sub,
        fontWeight: "900" as const,
        fontSize: 18,
      },
    }),
    []
  );

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
      .select(
        "id,created_at,placed_at,sport,bet_type,stake,event_label,status,result,profit,emotion,emotions,confidence"
      )
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
      loadBets();
    }, [loadBets])
  );

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
    [
      colors.open,
      colors.openBg,
      colors.win,
      colors.winBg,
      colors.loss,
      colors.lossBg,
      colors.push,
      colors.pushBg,
    ]
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

    setEditOpen(true);

    setTimeout(() => {
      editScrollRef.current?.scrollTo({ y: 0, animated: false });
    }, 0);
  }, []);

  const closeEdit = useCallback(() => {
    Keyboard.dismiss();
    setEditOpen(false);
    setSportOpen(false);
    setBetTypeOpen(false);
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

  const saveEdit = useCallback(async () => {
    Keyboard.dismiss();
    if (!editBetId) return;

    const stake = toNumStake(stakeText);
    if (!tidy(sport)) return Alert.alert("Missing", "Pick a sport.");
    if (!tidy(betType)) return Alert.alert("Missing", "Pick a bet type.");
    if (!Number.isFinite(stake) || stake <= 0) return Alert.alert("Missing", "Enter a valid stake.");

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
      };

      setBets((prev) => prev.map((b) => (b.id === editBetId ? { ...b, ...payload } : b)));

      const { error } = await supabase
        .from("bets")
        .update(payload)
        .eq("id", editBetId)
        .eq("user_id", user.id);

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

    const rawEmotions: string[] = item.emotions?.length
      ? item.emotions
      : item.emotion
        ? [item.emotion]
        : [];
    const emotionText = rawEmotions.length
      ? rawEmotions
          .map((e) => EMOTION_LABEL_BY_VALUE[e] ?? e)
          .map((lab) => lab.split(" ")[0]) // emoji only
          .join(" ")
      : "—";

    const conf = item.confidence ?? null;
    const confText =
      conf && Number.isFinite(conf) ? `${conf}/5 (${confidenceLabel(conf)})` : "—";

    const dateIso = item.placed_at ?? item.created_at ?? null;
    const placed = formatDate(dateIso);

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
      <FlatList
        data={bets}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 }}>
            <Text style={{ color: Theme.text, fontSize: 26, fontWeight: "900" }}>Bets</Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 30 }} />
          ) : (
            <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
              <Text style={{ color: Theme.sub }}>No bets yet.</Text>
            </View>
          )
        }
      />

      {/* ===================== EDIT MODAL (touch + scroll fixed, Android-safe) ===================== */}
      <Modal
        visible={editOpen}
        transparent
        animationType="fade"
        onRequestClose={closeEdit}
        presentationStyle="overFullScreen"
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }}>
          <Pressable
            onPress={closeEdit}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}
          />

          <View style={{ flex: 1, justifyContent: "center", padding: 16, zIndex: 2 }} pointerEvents="box-none">
            <View
              style={{
                width: "100%",
                height: "88%",
                backgroundColor: Theme.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: Theme.border,
                padding: 14,
                elevation: 20,
                zIndex: 10,
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
                  showsVerticalScrollIndicator
                >
                  {/* Sport + Bet Type */}
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Pressable
                      onPress={() => setSportOpen(true)}
                      hitSlop={12}
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
                      hitSlop={12}
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
                    <Text style={inputStyles.label}>Stake</Text>
                    <View style={inputStyles.container}>
                      <Text style={inputStyles.dollar}>$</Text>
                      <TextInput
                        value={stakeText}
                        onChangeText={setStakeText}
                        keyboardType="numeric"
                        returnKeyType="done"
                        onSubmitEditing={() => Keyboard.dismiss()}
                        placeholder=""
                        placeholderTextColor={Theme.sub}
                        style={inputStyles.input}
                      />
                    </View>
                  </View>

                  {/* Event */}
                  <View style={{ gap: 6 }}>
                    <Text style={inputStyles.label}>Game / Event</Text>
                    <View style={inputStyles.container}>
                      <TextInput
                        value={eventLabel}
                        onChangeText={setEventLabel}
                        returnKeyType="done"
                        onSubmitEditing={() => Keyboard.dismiss()}
                        placeholder="e.g. Hawks vs Heat"
                        placeholderTextColor={Theme.sub}
                        style={inputStyles.input}
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
                            hitSlop={10}
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
            </View>
          </View>
        </View>
      </Modal>

      {/* ===================== SPORT PICKER ===================== */}
      <Modal visible={sportOpen} transparent animationType="fade" onRequestClose={() => setSportOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 16 }}>
          <Pressable onPress={() => setSportOpen(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View
            style={{
              zIndex: 2,
              elevation: 20,
              width: "100%",
              height: "75%",
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 14,
            }}
          >
            <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18 }}>Select sport</Text>
            <ScrollView
              style={{ flex: 1, marginTop: 10 }}
              contentContainerStyle={{ gap: 10, paddingBottom: 10 }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {SPORTS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => {
                    setSport(String(s));
                    setSportOpen(false);
                  }}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: Theme.border,
                    backgroundColor: tidy(sport) === String(s) ? "#ffffff" : "transparent",
                  }}
                >
                  <Text style={{ color: tidy(sport) === String(s) ? "#0f1115" : Theme.text, fontWeight: "900" }}>
                    {s}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ===================== BET TYPE PICKER ===================== */}
      <Modal visible={betTypeOpen} transparent animationType="fade" onRequestClose={() => setBetTypeOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 16 }}>
          <Pressable onPress={() => setBetTypeOpen(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View
            style={{
              zIndex: 2,
              elevation: 20,
              width: "100%",
              height: "75%",
              backgroundColor: Theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 14,
            }}
          >
            <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 18 }}>Select bet type</Text>
            <ScrollView
              style={{ flex: 1, marginTop: 10 }}
              contentContainerStyle={{ gap: 10, paddingBottom: 10 }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {BET_TYPES.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => {
                    setBetType(String(t));
                    setBetTypeOpen(false);
                  }}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: Theme.border,
                    backgroundColor: tidy(betType) === String(t) ? "#ffffff" : "transparent",
                  }}
                >
                  <Text style={{ color: tidy(betType) === String(t) ? "#0f1115" : Theme.text, fontWeight: "900" }}>
                    {t}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}