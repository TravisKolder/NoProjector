"use client";

import { useState } from "react";

/** Copies text, with a fallback for browsers that block the clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function joinUrl(code: string) {
  return typeof window !== "undefined" ? `${window.location.origin}/s/${code}` : `/s/${code}`;
}

export default function CopyLinkButton({ code, className = "btn btn-sm" }: { code: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      className={className}
      onClick={async () => {
        const ok = await copyText(joinUrl(code));
        setState(ok ? "copied" : "failed");
        setTimeout(() => setState("idle"), 1800);
      }}
      aria-live="polite"
    >
      {state === "copied" ? "Link copied ✓" : state === "failed" ? "Copy failed" : "Copy link"}
    </button>
  );
}
