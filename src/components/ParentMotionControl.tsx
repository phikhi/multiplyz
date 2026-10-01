"use client";
import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/sound/use-prefers-reduced-motion";
import { parent as p } from "@/strings/parent";
export function ParentMotionControl() {
  const system = usePrefersReducedMotion();
  const [manual, setManual] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        setManual(localStorage.getItem("teddy:reduced") === "true");
      } catch {
        setUnavailable(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const toggle = () => {
    try {
      localStorage.setItem("teddy:reduced", String(!manual));
      setManual(!manual);
    } catch {
      setUnavailable(true);
    }
  };
  return (
    <fieldset>
      <legend>{p.motion}</legend>
      <button
        type="button"
        className="parent-secondary"
        role="switch"
        aria-checked={system || manual}
        disabled={system || unavailable}
        onClick={toggle}
      >
        {p.motion}
      </button>
      <p>{p.motionHint}</p>
      {unavailable && <p role="status">{p.motionUnavailable}</p>}
    </fieldset>
  );
}
