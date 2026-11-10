import Brand from "@/components/Brand";

/** Placeholders shaped like the page that's loading, so the layout doesn't jump when content arrives. */

function Bar({ w = "100%", h = 14, style }: { w?: string | number; h?: number; style?: React.CSSProperties }) {
  return <span className="skel" style={{ width: w, height: h, ...style }} />;
}

export function DeckGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="deck-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="deck-card">
          <span className="skel skel-slide" />
          <div className="stack" style={{ gap: 6 }}>
            <Bar w="70%" h={16} />
            <Bar w="35%" h={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DecksPageSkeleton() {
  return (
    <main className="page" aria-busy="true">
      <span className="sr-only">Loading your decks</span>
      <div className="topbar">
        <Brand />
        <Bar w={140} h={14} />
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <Bar w={140} h={26} />
        <span className="spacer" />
        <Bar w={110} h={44} />
      </div>
      <DeckGridSkeleton />
    </main>
  );
}

export function DeckBuilderSkeleton() {
  return (
    <main className="page" style={{ maxWidth: 1100 }} aria-busy="true">
      <span className="sr-only">Loading deck</span>
      <div className="topbar">
        <Brand />
        <Bar w={130} h={44} />
      </div>
      <div className="card stack" style={{ marginBottom: 20 }} aria-hidden="true">
        <Bar w={80} h={12} />
        <Bar h={44} />
        <div className="theme-swatches">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="skel" style={{ width: 64, height: 44 }} />
          ))}
        </div>
      </div>
      <div className="builder" aria-hidden="true">
        <div className="slide-rail">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="skel skel-slide" />
          ))}
        </div>
        <div className="editor-grid">
          <span className="skel skel-slide" />
          <div className="card stack">
            <Bar w={60} h={12} />
            <Bar h={44} />
            <Bar w={60} h={12} />
            <Bar h={96} />
          </div>
        </div>
      </div>
    </main>
  );
}

/** Viewer: a blank slide frame with the control bar, in the viewer's own dark layout. */
export function ViewerSkeleton() {
  return (
    <main className="viewer" aria-busy="true">
      <span className="sr-only">Loading slides</span>
      <div className="viewer-stage viewer-skeleton" aria-hidden="true">
        <span className="skel skel-dark" style={{ width: "55%", height: 28 }} />
        <span className="skel skel-dark" style={{ width: "80%", height: 16 }} />
        <span className="skel skel-dark" style={{ width: "72%", height: 16 }} />
        <span className="skel skel-dark" style={{ width: "76%", height: 16 }} />
      </div>
      <div className="viewer-bar" aria-hidden="true">
        <span className="dot" />
        <span className="skel skel-dark" style={{ width: 34, height: 14 }} />
        <span className="spacer" />
        <span className="skel skel-dark" style={{ width: 120, height: 30 }} />
      </div>
    </main>
  );
}
