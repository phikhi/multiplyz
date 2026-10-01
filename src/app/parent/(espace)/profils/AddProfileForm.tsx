"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { AVATARS } from "@/config/avatars";
import { NAME_MAX_LENGTH, PIN_LENGTH } from "@/lib/auth/validation";
import { PinPad } from "@/components/PinPad";
import { parent as p } from "@/strings/parent";
import { strings } from "@/strings";
import { createChildProfileAction } from "./actions";
export function AddProfileForm() {
  const router = useRouter();
  const focus = useCallback((node: HTMLHeadingElement | null) => node?.focus(), []);
  const [step, setStep] = useState<"closed" | "details" | "pin" | "confirm">("closed");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0].id);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const close = () => {
    setStep("closed");
    setPin("");
    setConfirm("");
    setName("");
    setError("");
  };
  const submit = async () => {
    if (busy) return;
    if (pin !== confirm) {
      setError(p.mismatch);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await createChildProfileAction({ name, avatar, pin });
      if (result.ok) {
        close();
        setSuccess(true);
        router.refresh();
      } else setError(strings.parent.manage.errors[result.code]);
    } catch {
      setError(strings.parent.manage.errors.GENERIC);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="parent-add-profile">
      <h2>{p.create}</h2>
      <p>{p.addHint}</p>
      {success && <p role="status">{p.createDone}</p>}
      {error && <p role="alert">{error}</p>}
      {step === "closed" ? (
        <button
          type="button"
          className="parent-secondary"
          onClick={() => {
            setStep("details");
            setSuccess(false);
          }}
        >
          {p.create}
        </button>
      ) : (
        <>
          {step === "details" ? (
            <>
              <label>
                {p.name}
                <input
                  value={name}
                  maxLength={NAME_MAX_LENGTH}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                {p.avatar}
                <select value={avatar} onChange={(e) => setAvatar(e.target.value)}>
                  {AVATARS.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.emoji}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <h3 tabIndex={-1} ref={focus}>
                {step === "pin" ? p.childPin : p.confirmPin}
              </h3>
              <PinPad
                value={step === "pin" ? pin : confirm}
                onChange={step === "pin" ? setPin : setConfirm}
                label={step === "pin" ? p.childPin : p.confirmPin}
                disabled={busy}
              />
            </>
          )}
          <div className="parent-actions">
            <button className="parent-secondary" disabled={busy} onClick={close}>
              {p.cancel}
            </button>
            <button
              className="parent-primary"
              disabled={
                busy ||
                (step === "details"
                  ? !name.trim()
                  : (step === "pin" ? pin : confirm).length !== PIN_LENGTH)
              }
              onClick={() => {
                if (step === "details") setStep("pin");
                else if (step === "pin") setStep("confirm");
                else void submit();
              }}
            >
              {step === "confirm" ? p.create : p.next}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
