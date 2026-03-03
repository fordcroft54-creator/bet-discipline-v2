// src/screens/EditBetScreen.tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
 * EditBetScreen (separate screen)
 * Route: /edit-bet?betId=...
 *
 * ✅ Global sport + bet type options (not based on user's history)
 * ✅ Edit result (Open / Win / Loss / Push)
 * ✅ If Win → enter "Payout" (saved to `profit`)
 */

type Result = "win" | "loss" | "push" | null;
type Status = "open" | "settled" | null;

type Bet = {
  id: string;
  created_at?: string | null;
  placed_at?: string | null;

  sport?: string | null;
  bet_type?: string | null;

  stake?: number | null;
  event_label?: string | null;

  emotion?: string | null;
  emotions?: string[] | null;

  confidence?: number | null;

  status?: Status;
  result?: Result;
  profit?: number | null;
  settled_at?: string | null;
};

/** ✅ GLOBAL OPTIONS (edit once, used everywhere) */
const SPORT_OPTIONS = [
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

const BET_TYPE_OPTIONS = [
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

const RESULT_OPTIONS = ["Open", "Win", "Loss", "Push"] as const;
type ResultUI = (typeof RESULT_OPTIONS)[number];

function tidy(s?: string | null) {
  if (!s) return "";
  return String(s).replace(/\s+/g, " ").trim();
}

function digitsAndDot(s: string) {
  const cleaned = (s ?? "").replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function toNumMoney(s: string) {
  const cleaned = digitsAndDot(s ?? "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
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
 * Touch-safe SelectModal
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} presentationStyle="overFullScreen">
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

function resultToUI(status?: Status, result?: Result): ResultUI {
  if (status === "open") return "Open";
  if (result === "win") return "Win";
  if (result === "loss") return "Loss";
  if (result === "push") return "Push";
  return "Open";
}

function uiToDbResult(ui: ResultUI): { status: Status; result: Result } {
  if (ui === "Open") return { status: "open", result: null };
  if (ui === "Win") return { status: "settled", result: "win" };
  if (ui === "Loss") return { status: "settled", result: "loss" };
  return { status: "settled", result: "push" };
}

export default function EditBetScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ betId?: string }>();
  const betId = typeof params.betId === "string" ? params.betId : "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [sportOpen, setSportOpen] = useState(false);
  const [betTypeOpen, setBetTypeOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);

  const [sport, setSport] = useState("");
  const [betType, setBetType] = useState("");
  const [stakeText, setStakeText] = useState("");
  const [eventLabel, setEventLabel] = useState("");
  const [selectedEmotions, setSelectedEmotions] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);

  const [resultUI, setResultUI] = useState<ResultUI>("Open");
  const [payoutText, setPayoutText] = useState<string>("");

  // date + pickers
  const [placedAt, setPlacedAt] = useState<Date>(() => new Date());
  const [dateQuickOpen, setDateQuickOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [iosDraftDate, setIosDraftDate] = useState<Date>(() => new Date());

  const placedAtLabel = useMemo(() => {
    const d = placedAt instanceof Date && !Number.isNaN(placedAt.getTime()) ? placedAt : new Date();
    const now = new Date();
    if (sameLocalDay(d, now)) return `Today · ${formatPrettyDate(d)}`;
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (sameLocalDay(d, y)) return `Yesterday · ${formatPrettyDate(d)}`;
    return formatPrettyDate(d);
  }, [placedAt]);

  const stakeNum = useMemo(() => toNumMoney(stakeText), [stakeText]);

  const canSave = useMemo(() => {
    if (!betId) return false;
    if (!tidy(sport) || !tidy(betType)) return false;
    if (!(stakeNum > 0)) return false;
    if (resultUI === "Win") {
      const payout = toNumMoney(payoutText);
      if (!(payout > 0)) return false;
    }
    return true;
  }, [betId, sport, betType, stakeNum, resultUI, payoutText]);

  const toggleEmotion = useCallback((val: string) => {
    setSelectedEmotions((prev) => {
      const has = prev.includes(val);
      if (has) return prev.filter((x) => x !== val);
      if (prev.length >= 3) return prev;
      return [...prev, val];
    });
  }, []);

  const setDateDaysAgo = (daysAgo: number) => {
    const now = new Date();
    const d = new Date(now);
    d.setDate(now.getDate() - daysAgo);
    setPlacedAt(normalizePickedDate(d));
  };

  const openOtherCalendar = () => {
    setDateQuickOpen(false);
    if (Platform.OS === "ios") {
      setIosDraftDate(placedAt);
      setCalendarOpen(true);
    } else {
      setCalendarOpen(true);
    }
  };

  useEffect(() => {
    if (resultUI !== "Win") setPayoutText("");
  }, [resultUI]);

  const load = useCallback(async () => {
    if (!betId) {
      setLoading(false);
      Alert.alert("Missing betId", "Open this screen via /edit-bet?betId=...");
      return;
    }

    setLoading(true);
    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr) throw userErr;
      if (!user) throw new Error("Not logged in.");

      const { data: bet, error: betErr } = await supabase
        .from("bets")
        .select(
          "id,created_at,placed_at,sport,bet_type,stake,event_label,emotion,emotions,confidence,status,result,profit,settled_at"
        )
        .eq("id", betId)
        .eq("user_id", user.id)
        .single();

      if (betErr) throw betErr;

      const b = bet as Bet;

      const rawEmotions: string[] = b.emotions?.length ? b.emotions : b.emotion ? [b.emotion] : [];
      const iso = b.placed_at ?? b.created_at ?? null;
      const dt = iso ? new Date(iso) : new Date();
      const safeDate = Number.isNaN(dt.getTime()) ? new Date() : dt;

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
      setPlacedAt(safeDate);

      const ui = resultToUI((b.status as Status) ?? null, (b.result as Result) ?? null);
      setResultUI(ui);

      if (ui === "Win" && typeof b.profit === "number" && Number.isFinite(b.profit) && b.profit > 0) {
        setPayoutText(String(b.profit));
      } else {
        setPayoutText("");
      }
    } catch (e: any) {
      Alert.alert("Load failed", e?.message ?? "Try again.");
    } finally {
      setLoading(false);
    }
  }, [betId]);

  useEffect(() => {
    load();
  }, [load]);

  const onSave = useCallback(async () => {
    Keyboard.dismiss();
    if (!betId) return;

    const stake = toNumMoney(stakeText);
    if (!tidy(sport)) return Alert.alert("Missing", "Pick a sport.");
    if (!tidy(betType)) return Alert.alert("Missing", "Pick a bet type.");
    if (!Number.isFinite(stake) || stake <= 0) return Alert.alert("Missing", "Enter a valid stake.");

    const { status, result } = uiToDbResult(resultUI);

    let profit: number | null = null;
    let settledAtIso: string | null = null;

    if (status === "open") {
      profit = null;
      settledAtIso = null;
    } else {
      settledAtIso = new Date().toISOString();
      if (result === "win") {
        const payout = toNumMoney(payoutText);
        if (!Number.isFinite(payout) || payout <= 0) return Alert.alert("Missing", "Enter a payout for a win.");
        profit = payout; // saved to profit
      } else if (result === "loss") {
        profit = -Math.abs(stake);
      } else if (result === "push") {
        profit = 0;
      }
    }

    const placedAtIso =
      placedAt instanceof Date && !Number.isNaN(placedAt.getTime()) ? placedAt.toISOString() : null;

    setSaving(true);
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

        status,
        result,
        profit,
        settled_at: settledAtIso,
      };

      const { error } = await supabase.from("bets").update(payload).eq("id", betId).eq("user_id", user.id);
      if (error) throw error;

      router.back();
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Try again.");
    } finally {
      setSaving(false);
    }
  }, [
    betId,
    sport,
    betType,
    stakeText,
    eventLabel,
    selectedEmotions,
    confidence,
    placedAt,
    router,
    resultUI,
    payoutText,
  ]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ color: Theme.sub, marginTop: 10, fontWeight: "800" }}>Loading bet…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
      {/* pickers */}
      <SelectModal
        title="Select sport"
        visible={sportOpen}
        options={SPORT_OPTIONS as any}
        selected={(sport || SPORT_OPTIONS[0]) as any}
        onSelect={(v) => setSport(String(v))}
        onClose={() => setSportOpen(false)}
      />
      <SelectModal
        title="Select bet type"
        visible={betTypeOpen}
        options={BET_TYPE_OPTIONS as any}
        selected={(betType || BET_TYPE_OPTIONS[0]) as any}
        onSelect={(v) => setBetType(String(v))}
        onClose={() => setBetTypeOpen(false)}
      />
      <SelectModal
        title="Select result"
        visible={resultOpen}
        options={RESULT_OPTIONS as any}
        selected={resultUI as any}
        onSelect={(v) => setResultUI(v as any)}
        onClose={() => setResultOpen(false)}
      />

      {/* Date quick picks */}
      <Modal
        visible={dateQuickOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDateQuickOpen(false)}
        presentationStyle="overFullScreen"
      >
        <Pressable
          onPress={() => setDateQuickOpen(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 16, justifyContent: "flex-end" }}
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
              <Pressable onPress={() => setDateQuickOpen(false)} hitSlop={10}>
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
                  setDateDaysAgo(0);
                  setDateQuickOpen(false);
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
                  setDateDaysAgo(1);
                  setDateQuickOpen(false);
                }}
              />
              <Chip
                label="2 days ago"
                selected={false}
                onPress={() => {
                  setDateDaysAgo(2);
                  setDateQuickOpen(false);
                }}
              />
              <Chip
                label="3 days ago"
                selected={false}
                onPress={() => {
                  setDateDaysAgo(3);
                  setDateQuickOpen(false);
                }}
              />
              <Chip label="Other…" selected={false} onPress={openOtherCalendar} />
            </View>

            <View style={{ height: 10 }} />
            <Text style={{ color: Theme.sub, fontSize: 12, fontWeight: "700" }}>
              Past dates are saved at midday to avoid timezone edge cases.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      {/* iOS inline calendar */}
      <Modal
        visible={Platform.OS === "ios" && calendarOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCalendarOpen(false)}
        presentationStyle="overFullScreen"
      >
        <Pressable
          onPress={() => setCalendarOpen(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 16, justifyContent: "flex-end" }}
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
                <Button title="Cancel" onPress={() => setCalendarOpen(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Apply"
                  onPress={() => {
                    setPlacedAt(normalizePickedDate(iosDraftDate));
                    setCalendarOpen(false);
                  }}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Android native */}
      {Platform.OS === "android" && calendarOpen && (
        <DateTimePicker
          value={placedAt}
          mode="date"
          display="default"
          onChange={(_event, selected) => {
            setCalendarOpen(false);
            if (!selected) return;
            setPlacedAt(normalizePickedDate(selected));
          }}
        />
      )}

      {/* Top bar */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 10,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: Theme.border,
          }}
        >
          <Text style={{ color: Theme.sub, fontWeight: "900" }}>Back</Text>
        </Pressable>

        <Text style={{ color: Theme.text, fontSize: 22, fontWeight: "900", flex: 1, textAlign: "center" }}>
          Edit Bet
        </Text>

        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Bet Date */}
          <Pressable
            onPress={() => setDateQuickOpen(true)}
            style={{
              backgroundColor: Theme.card,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 12,
              gap: 6,
            }}
          >
            <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Bet date</Text>
            <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>{placedAtLabel}</Text>
          </Pressable>

          {/* Sport + Bet Type */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={() => setSportOpen(true)}
              style={{
                flex: 1,
                backgroundColor: Theme.card,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: Theme.border,
                padding: 12,
                gap: 6,
              }}
            >
              <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Sport</Text>
              <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>{sport ? sport : "Select"}</Text>
            </Pressable>

            <Pressable
              onPress={() => setBetTypeOpen(true)}
              style={{
                flex: 1,
                backgroundColor: Theme.card,
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

          {/* Result */}
          <Pressable
            onPress={() => setResultOpen(true)}
            style={{
              backgroundColor: Theme.card,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: Theme.border,
              padding: 12,
              gap: 6,
            }}
          >
            <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Result</Text>
            <Text style={{ color: Theme.text, fontWeight: "900", fontSize: 16 }}>{resultUI}</Text>
          </Pressable>

          {/* Payout */}
          {resultUI === "Win" && (
            <View style={{ gap: 6 }}>
              <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Payout (if win)</Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  backgroundColor: Theme.card,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: Theme.border,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 18 }}>$</Text>
                <TextInput
                  value={payoutText}
                  onChangeText={(t) => setPayoutText(digitsAndDot(t))}
                  keyboardType="numeric"
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  placeholder="0"
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
          )}

          {/* Stake */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Stake</Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                backgroundColor: Theme.card,
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
                onChangeText={(t) => setStakeText(digitsAndDot(t))}
                keyboardType="numeric"
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                placeholder="0"
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

          {/* Game/Event */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: Theme.sub, fontWeight: "900", fontSize: 12 }}>Game / Event</Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                backgroundColor: Theme.card,
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
              Selected <Text style={{ color: Theme.text, fontWeight: "900" }}>{selectedEmotions.length}</Text>/3
            </Text>
          </View>

          <Button title={saving ? "Saving…" : "Save Changes"} onPress={onSave} disabled={!canSave || saving} />
          <Pressable onPress={() => router.back()} style={{ alignItems: "center", paddingVertical: 10 }}>
            <Text style={{ color: Theme.sub, fontWeight: "900" }}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}