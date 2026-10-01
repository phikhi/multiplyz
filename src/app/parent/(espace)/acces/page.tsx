import Link from "next/link";
import { parent as p } from "@/strings/parent";
export default function ParentAccessPage() {
  return (
    <main className="parent-page">
      <header className="parent-heading">
        <p className="parent-eyebrow">{p.access}</p>
        <h1>{p.accessTitle}</h1>
        <p>{p.accessIntro}</p>
      </header>
      <div className="parent-columns">
        <section className="parent-panel">
          <h2>{p.accessChild}</h2>
          <p>{p.accessChildHint}</p>
          <Link className="parent-text-link" href="/parent/profils">
            {p.profiles}
          </Link>
        </section>
        <section className="parent-panel">
          <h2>{p.accessParent}</h2>
          <p>{p.accessParentHint}</p>
          <Link className="parent-text-link" href="/parent/recuperation">
            {p.recover}
          </Link>
        </section>
      </div>
      <p>{p.accessExit}</p>
    </main>
  );
}
