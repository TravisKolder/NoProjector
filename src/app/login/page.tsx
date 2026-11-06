"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Brand from "@/components/Brand";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The callback routes send people back here with ?error=link when a link fails.
    if (new URLSearchParams(window.location.search).get("error") === "link") {
      setError("That sign-in link didn't work. It may have expired or opened in a different browser. Request a new one and enter the code from the email instead.");
    }
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/decks` },
    });
    setBusy(false);
    if (error) {
      setError(
        /rate limit/i.test(error.message)
          ? "Too many sign-in emails were sent recently. Check your inbox for one already sent, or wait about an hour and try once."
          : error.message,
      );
    } else {
      setSent(true);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.replace(/\D/g, ""),
      type: "email",
    });
    setBusy(false);
    if (error) {
      setError("That code didn't work. Check it, or use the newest email if you requested more than one.");
      return;
    }
    router.replace("/decks");
    router.refresh();
  }

  return (
    <main className="page narrow">
      <div className="topbar">
        <Brand />
      </div>
      <div className="card stack">
        <h1 style={{ fontSize: 24 }}>Presenter sign-in</h1>
        {sent ? (
          <form className="stack" onSubmit={verify}>
            <p className="muted" style={{ margin: 0 }}>
              We emailed <strong>{email}</strong>. Enter the code from the email here. It works on any device.
            </p>
            <label className="label" htmlFor="otp">
              Sign-in code
            </label>
            <input
              id="otp"
              className="input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
            {error ? <p className="error">{error}</p> : null}
            <button className="btn btn-primary btn-block" disabled={busy || code.length < 6}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSent(false);
                setCode("");
                setError(null);
              }}
            >
              Use a different email
            </button>
          </form>
        ) : (
          <form className="stack" onSubmit={send}>
            <p className="muted" style={{ margin: 0 }}>
              We&apos;ll email you a sign-in code. No password needed. Viewers never need to sign in.
            </p>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error ? <p className="error">{error}</p> : null}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Sending…" : "Email me a sign-in code"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
