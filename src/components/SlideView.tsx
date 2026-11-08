import type { CSSProperties, ReactNode } from "react";
import type { Slide } from "@/lib/types";
import { getTheme, type Theme } from "@/lib/themes";

type Variant = "full" | "preview" | "thumb" | "card";

type Props = {
  slide: Slide | undefined;
  theme: string;
  variant?: Variant;
  /** Viewer text-size multiplier (1 = default). Built slides only. */
  scale?: number;
  /** Viewer override: force a light or dark look regardless of the deck theme. */
  mode?: "deck" | "light" | "dark";
};

const BASE: Record<Variant, string> = {
  full: "clamp(17px, 2.2vw + 10px, 34px)",
  preview: "clamp(9px, 1.1vw, 16px)",
  thumb: "5px",
  // Scales with the width of its container (needs `container-type: inline-size` on a parent).
  card: "4cqw",
};

function resolveTheme(themeId: string, mode: Props["mode"]): Theme {
  if (mode === "light") return getTheme("light");
  if (mode === "dark") return getTheme("dark");
  return getTheme(themeId);
}

/** "- item" lines become bullets; blank lines split paragraphs. */
function renderBody(body: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = body.replace(/\r/g, "").split("\n");
  let bullets: { text: string; level: number }[] = [];
  let para: string[] = [];

  const flushBullets = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`u${blocks.length}`} className="slide-list">
          {bullets.map((b, i) => (
            <li key={i} className={b.level ? `lvl-${Math.min(b.level, 4)}` : undefined}>
              {b.text}
            </li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={`p${blocks.length}`} className="slide-para">
          {para.join("\n")}
        </p>,
      );
      para = [];
    }
  };

  for (const line of lines) {
    const m = line.match(/^(\s*)(?:[-•*])\s+(.*)$/);
    if (m) {
      flushPara();
      // Two spaces (or a tab) of indent = one level deeper.
      const indent = m[1].replace(/\t/g, "  ").length;
      bullets.push({ text: m[2], level: Math.floor(indent / 2) });
    } else if (line.trim() === "") {
      flushBullets();
      flushPara();
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushBullets();
  flushPara();
  return blocks;
}

export default function SlideView({ slide, theme, variant = "full", scale = 1, mode = "deck" }: Props) {
  const t = resolveTheme(theme, mode);
  const style = {
    "--slide-bg": t.bg,
    "--slide-fg": t.fg,
    "--slide-muted": t.muted,
    "--slide-accent": t.accent,
    "--slide-rule": t.rule,
    "--slide-font": t.font,
    "--slide-base": BASE[variant],
    "--slide-scale": variant === "full" ? String(scale) : "1",
  } as CSSProperties;

  if (!slide) {
    return <div className={`slide slide-${variant} slide-empty`} style={style} />;
  }

  if (slide.kind === "image" && slide.content.imageUrl) {
    return (
      <div className={`slide slide-${variant} slide-image-only`} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={slide.content.imageUrl} alt={slide.content.title ?? "Slide"} draggable={false} />
      </div>
    );
  }

  const { title, body, imageUrl, table } = slide.content;
  const hasTable = !!table && table.length > 0 && table.some((r) => r.some((c) => c.trim() !== ""));
  const onlyTitle = !!title && !body && !imageUrl && !hasTable;

  return (
    <div className={`slide slide-${variant}${onlyTitle ? " slide-title-only" : ""}`} style={style}>
      <div className="slide-inner">
        {title ? <h2 className="slide-title">{title}</h2> : null}
        {body ? <div className="slide-body">{renderBody(body)}</div> : null}
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="slide-img" src={imageUrl} alt="" draggable={false} />
        ) : null}
        {hasTable ? (
          <div className="slide-table-wrap">
            <table className="slide-table">
              <thead>
                <tr>
                  {table![0].map((c, i) => (
                    <th key={i}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table!.slice(1).map((row, r) => (
                  <tr key={r}>
                    {row.map((c, i) => (
                      <td key={i}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
