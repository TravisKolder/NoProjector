"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { setPresenterToken } from "@/lib/device";

/** Starts a live session for a deck and keeps the presenter token on this device. Returns the join code. */
export async function startSession(supabase: SupabaseClient, deckId: string, presenterName: string) {
  const { data, error } = await supabase.rpc("start_session", { p_deck_id: deckId, p_presenter_name: presenterName });
  if (error || !data) throw new Error(error?.message ?? "Could not start the session");
  const { code, token } = data as { code: string; token: string };
  setPresenterToken(code, token);
  return code;
}

/** Where to go to present a set: the session opens on the set's first song. */
export const presentSetPath = (code: string, setId: string) => `/present/${code}?set=${setId}`;
