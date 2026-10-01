"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { ParentExitButton } from "./ParentExitButton";
import { parent as p } from "@/strings/parent";

export function ParentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const profile = params.get("profile");
  const links = [
    ["/parent", p.dashboard],
    ["/parent/reglages", p.settings],
    ["/parent/profils", p.profiles],
    ["/parent/mondes", p.worlds],
    ["/parent/acces", p.access],
  ];
  return (
    <div className="parent-shell">
      <a href="#parent-content" className="parent-skip">
        {p.skip}
      </a>
      <header className="parent-masthead">
        <div>
          <span className="parent-brand">{p.brand}</span>
          <span className="parent-kicker">{p.notebook}</span>
        </div>
        <ParentExitButton />
      </header>
      <nav className="parent-nav" aria-label={p.nav}>
        {links.map(([href, label]) => (
          <Link
            key={href}
            href={
              profile && (href === "/parent" || href === "/parent/reglages")
                ? `${href}?profile=${encodeURIComponent(profile)}`
                : href
            }
            aria-current={pathname === href ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div id="parent-content" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
