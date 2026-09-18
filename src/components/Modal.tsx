"use client";
import { useEffect, useId, useRef } from "react";

/** Fælles ramme om modalerne — luk på Escape, på baggrunden og på krydset. */
export function Modal({ eyebrow, title, sub, footer, wide = false, scrollKey, onClose, children }: {
  eyebrow: string;
  title: string;
  sub?: React.ReactNode;
  footer?: React.ReactNode;
  /** Til modaler med tabeller frem for løbende tekst — fx styklisten. */
  wide?: boolean;
  /** Skifter værdi når indholdet udskiftes, fx ved fanebyt. Ruller til toppen. */
  scrollKey?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Nyt indhold starter øverst — ellers står man midt i den næste fane.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [scrollKey]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // capture, så modalen lukkes før Escape rammer resten af kortet
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fm-modal-back" onClick={onClose}>
      <div
        className={`fm-modal${wide ? " is-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fm-modal-head">
          <div>
            <div className="fm-modal-eyebrow">{eyebrow}</div>
            <h2 id={titleId}>{title}</h2>
            {sub && <div className="fm-modal-sub">{sub}</div>}
          </div>
          <button ref={closeRef} type="button" className="fm-close" aria-label="Luk" onClick={onClose}>×</button>
        </div>
        {/* Ét rullepanel om hele indholdet — ikke ét pr. afsnit. */}
        <div className="fm-modal-scroll" ref={scrollRef}>{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}


export function Field({ label, value, empty = "Ikke udfyldt" }: { label: string; value?: string; empty?: string }) {
  return (
    <div className="fm-field">
      <dt>{label}</dt>
      <dd className={value ? "" : "is-empty"}>{value || empty}</dd>
    </div>
  );
}

