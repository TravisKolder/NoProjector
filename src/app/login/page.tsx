"use client";

import { useState } from "react";
import Brand from "@/components/Brand";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="page narrow">
      <div className="topbar">
        <Brand />
      </div>
      <div className="card stack">
        <h1 style={{ fontSize: 24 }}>Presenter sign-in</h1>
        {sent ? (
          <p className="muted">
            Check <strong>{email}</strong> for a sign-in link. Open it on this device.
          </p>
        ) : (
          <form className="stack" onSubmit={send}>
            <p className="muted" style={{ margin: 0 }}>
              We&apos;ll email you a link. No password needed. Viewers never need to sign in.
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
              {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
