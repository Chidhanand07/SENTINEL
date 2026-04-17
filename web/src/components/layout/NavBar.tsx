"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MLFLOW_URL = process.env.NEXT_PUBLIC_MLFLOW_URL || "http://localhost:5001";

export function NavBar() {
  const pathname = usePathname();
  const connected = true;
  const links = [
    { href: "/", label: "Home" },
    { href: "/upload", label: "Upload" },
    { href: "/history", label: "History" },
  ];

  return (
    <header className="h-11 border-b border-border bg-bg sticky top-0 z-50">
      <div className="h-full px-4 flex items-center">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid grid-cols-2 gap-[3px]">
            <span className="w-1 h-1 rounded-full bg-accent" />
            <span className="w-1 h-1 rounded-full bg-accent" />
            <span className="w-1 h-1 rounded-full bg-accent" />
            <span className="w-1 h-1 rounded-full bg-accent" />
          </span>
          <span className="text-[13px] font-semibold tracking-[0.1em] text-text-1">SENTINEL</span>
        </Link>
        <nav className="mx-auto flex items-center gap-4">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`text-[13px] ${pathname === l.href ? "text-text-1" : "text-text-3 hover:text-text-2"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 text-[12px]">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "animate-pulse-bg" : ""}`} style={{ background: connected ? "var(--green)" : "var(--surface-3)" }} />
          <span className={connected ? "text-text-2" : "text-text-3"}>{connected ? "Live" : "Offline"}</span>
          <span className="text-text-3">|</span>
          <a href="http://localhost:5678" target="_blank" rel="noreferrer" className="text-text-3 hover:text-text-2">n8n ↗</a>
          <a href={MLFLOW_URL} target="_blank" rel="noreferrer" className="text-text-3 hover:text-text-2">MLflow ↗</a>
        </div>
      </div>
    </header>
  );
}
