"use client";

import { QRCodeSVG } from "qrcode.react";
import CopyLinkButton, { joinUrl } from "@/components/CopyLinkButton";

export default function QrModal({ code, onClose }: { code: string; onClose: () => void }) {
  const url = joinUrl(code);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Join code">
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <h3>Scan to follow along</h3>
        <div className="qr-box">
          <QRCodeSVG value={url} size={260} level="M" marginSize={1} />
        </div>
        <div className="qr-code-text">{code}</div>
        <div>
          <span className="label">Or send this link</span>
          <input
            className="input link-field"
            readOnly
            value={url.replace(/^https?:\/\//, "")}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Join link"
          />
        </div>
        <div className="row">
          <CopyLinkButton code={code} className="btn btn-sm btn-primary" />
          {canShare ? (
            <button
              className="btn btn-sm"
              onClick={() => navigator.share({ title: "Follow along on No Projector", url }).catch(() => {})}
            >
              Share…
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
