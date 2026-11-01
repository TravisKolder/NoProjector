"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const clean = code.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean.length === 6) router.push(`/s/${clean}`);
      }}
    >
      <label className="label" htmlFor="code">
        Joining a presentation? Enter the code
      </label>
      <input
        id="code"
        className="input code-input"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        placeholder="ABC234"
        value={clean}
        onChange={(e) => setCode(e.target.value)}
      />
      <button className="btn btn-primary btn-block" disabled={clean.length !== 6}>
        Join
      </button>
    </form>
  );
}
