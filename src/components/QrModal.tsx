"use client";

import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

export default function QrModal({ code, onClose }: { code: string; onClose: () => void }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}/s/${code}` : "";
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Join code">
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <h3>Scan to follow along</h3>
        <div className="qr-box">
          <QRCodeSVG value={url} size={260} level="M" marginSize={1} />
        </div>
        <div className="qr-code-text">{code}</div>
        <p className="subtle" style={{ textAlign: "center", margin: 0 }}>
          Or open {url.replace(/^https?:\/\//, "").replace(/\/s\/.*$/, "")} and enter the code
        </p>
        <div className="row">
          <button
            className="btn btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {}
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          {canShare ? (
            <button
              className="btn btn-sm"
              onClick={() => navigator.share({ title: "Follow along", url }).catch(() => {})}
            >
              Share
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn btn-sm btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
