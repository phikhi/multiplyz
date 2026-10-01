"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { strings } from "@/strings";
import { PIN_LENGTH } from "@/lib/auth/validation";

export interface PinPadProps {
  value: string;
  onChange: (next: string) => void;
  label: string;
  disabled?: boolean;
}
const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const filled = "●",
  empty = "○",
  erase = "⌫",
  zero = "0";

/** A single controlled pad for touch and keyboard; codes are never stored locally. */
export function PinPad({ value, onChange, label, disabled = false }: PinPadProps) {
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  }, [value]);
  const change = (next: string) => {
    if (disabled) return;
    latest.current = next;
    onChange(next);
  };
  const press = (digit: string) => {
    if (latest.current.length < PIN_LENGTH) change(latest.current + digit);
  };
  const backspace = () => {
    if (latest.current.length) change(latest.current.slice(0, -1));
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.repeat)
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable)
      )
        return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        backspace();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  const key = (digit: string) => (
    <button
      key={digit}
      type="button"
      disabled={disabled}
      className="mz-focusable pin-key"
      aria-label={strings.pinPad.digit.replace("{d}", digit)}
      onClick={() => press(digit)}
    >
      {digit}
    </button>
  );
  return (
    <div role="group" aria-label={label} className="pin-pad" aria-busy={disabled}>
      <div className="pin-dots">
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            role="img"
            aria-label={(index < value.length
              ? strings.pinPad.dotFilled
              : strings.pinPad.dotEmpty
            ).replace("{n}", String(index + 1))}
          >
            {index < value.length ? filled : empty}
          </span>
        ))}
      </div>
      <div className="pin-grid">
        {digits.map(key)}
        <span aria-hidden="true" />
        {key(zero)}
        <button
          className="mz-focusable pin-key"
          type="button"
          disabled={disabled}
          aria-label={strings.pinPad.backspace}
          onClick={backspace}
        >
          {erase}
        </button>
      </div>
    </div>
  );
}
