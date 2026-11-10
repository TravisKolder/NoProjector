export type ThemeId = "light" | "dark" | "warm" | "bold";

export type SlideContent = {
  title?: string;
  body?: string;
  imageUrl?: string;
  table?: string[][];
  notes?: string;
};

export type Slide = {
  id: string;
  kind: "built" | "image";
  content: SlideContent;
};

export type SessionState = {
  id: string;
  code: string;
  status: "live" | "ended";
  current_slide: number;
  slide_count: number;
  presenter_name: string;
  presenter_epoch: number;
  handoff_to: string | null;
  handoff_from: string | null;
  keep_after: boolean;
  ended_at: string | null;
  is_owner: boolean;
  deck: { title: string; theme: ThemeId };
  slides: Slide[];
};

export type GetSessionResult = SessionState | { code: string; expired: true } | null;

/** Everything in a session except the slides (from get_session_state). */
export type SessionLiveState = Omit<SessionState, "slides">;
export type GetSessionStateResult = SessionLiveState | { code: string; expired: true } | null;

export type PresenceMember = {
  clientId: string;
  name: string;
  role: "presenter" | "viewer";
};
