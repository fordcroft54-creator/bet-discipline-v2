import React, { useRef, useState } from "react";
import { SafeAreaView, Text, TextInput, View } from "react-native";
import { supabase } from "../src/lib/supabase";
import { Button } from "../src/ui/Button";
import { Field } from "../src/ui/Field";
import { FormScreen } from "../src/ui/FormScreen";
import { Theme } from "../src/ui/Theme";

export default function AuthEntryScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // For keyboard "Next" -> focus Password
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
  setMsg(null);
  const e = email.trim();
  if (!e || !password) return setMsg("Enter email and password.");

  setBusy(true);
  try {
    if (mode === "login") {
      const { data, error } = await supabase.auth.signInWithPassword({ email: e, password });
      if (error) throw error;

      // Helpful debug
      console.log("login session?", !!data.session);
    } else {
      const { data, error } = await supabase.auth.signUp({ email: e, password });
      if (error) throw error;

      // If email confirmation is enabled, session will be null here.
      if (!data.session) {
        setMsg("Check your email to confirm your account, then log in.");
      } else {
        setMsg("Account created — you’re logged in.");
      }
    }
  } catch (err: any) {
    setMsg(err?.message ?? "Auth error");
  } finally {
    setBusy(false);
  }
};

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Theme.bg }}>
      <FormScreen contentStyle={{ gap: 14 }}>
        <Text style={{ color: Theme.text, fontSize: 28, fontWeight: "900" }}>
          Bet Discipline
        </Text>
        <Text style={{ color: Theme.sub, fontSize: 16 }}>
          Build guardrails. Track behavior. Stay in control.
        </Text>

        <View style={{ height: 12 }} />

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />

        {/* IMPORTANT: this requires Field to be forwardRef-enabled */}
        <Field
          label="Password"
          ref={passwordRef}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          returnKeyType="done"
          onSubmitEditing={submit}
          blurOnSubmit
        />

        {msg ? <Text style={{ color: Theme.warn, fontWeight: "700" }}>{msg}</Text> : null}

        <Button
          title={busy ? "…" : mode === "login" ? "Log In" : "Sign Up"}
          onPress={submit}
          disabled={busy}
        />

        <Button
          title={mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
          variant="secondary"
          onPress={() => setMode((m) => (m === "login" ? "signup" : "login"))}
        />
      </FormScreen>
    </SafeAreaView>
  );
}