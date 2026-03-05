import React, { useRef, useState } from "react";
import { SafeAreaView, Text, TextInput, View, Image } from "react-native";
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

  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    setMsg(null);
    const e = email.trim();
    if (!e || !password) return setMsg("Enter email and password.");

    setBusy(true);
    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: e,
          password,
        });
        if (error) throw error;

        console.log("login session?", !!data.session);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: e,
          password,
        });
        if (error) throw error;

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

        {/* Branding Section */}
        <View style={{ alignItems: "center", gap: 10, paddingTop: 10 }}>
          <Image
            source={require("../assets/appicon.png")}
            style={{
              width: 100,
              height: 100,
              borderRadius: 30
            }}
            resizeMode="contain"
          />

          <Text
            style={{
              color: Theme.text,
              fontSize: 34,
              fontWeight: "900",
              letterSpacing: 0.5
            }}
          >
            Tilt Check
          </Text>

          <Text
            style={{
              color: Theme.sub,
              fontSize: 20,
              textAlign: "center",
              lineHeight: 22
            }}
          >
            You know ball. We know you.
          </Text>
        </View>

        <View style={{ height: 6 }} />

        {/* Mode label */}
        <Text
          style={{
            color: Theme.sub,
            fontSize: 13,
            fontWeight: "700",
            letterSpacing: 0.8
          }}
        >
          {mode === "login" ? "LOG IN" : "SIGN UP"}
        </Text>

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

        {msg ? (
          <View
            style={{
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: "rgba(255,180,0,0.10)",
              borderWidth: 1,
              borderColor: "rgba(255,180,0,0.25)"
            }}
          >
            <Text style={{ color: Theme.warn, fontWeight: "800" }}>
              {msg}
            </Text>
          </View>
        ) : null}

        <Button
          title={busy ? "…" : mode === "login" ? "Log In" : "Create account"}
          onPress={submit}
          disabled={busy}
        />

        <Button
          title={
            mode === "login"
              ? "Need an account? Sign up"
              : "Have an account? Log in"
          }
          variant="secondary"
          onPress={() =>
            setMode((m) => (m === "login" ? "signup" : "login"))
          }
        />

        <Text
          style={{
            color: Theme.sub,
            fontSize: 14,
            textAlign: "center",
            lineHeight: 18
          }}
        >
          Tilt Check helps you track bets, confidence, and emotions so you can
          understand your betting habits and avoid betting on tilt.
        </Text>

      </FormScreen>
    </SafeAreaView>
  );
}