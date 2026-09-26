"use client";
import { BRAND, TAGLINE } from "@/lib/brand";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { setTheme, useTheme } from "@/lib/theme";

// The mark: a tyre with the water standing at its hub, the waterline the product is named for.
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="11" r="8.5" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="12" cy="11" r="2.4" fill="currentColor" />
      <path d="M1 14.2h22V24H1z" fill="var(--accent)" opacity="0.35" />
      <path d="M1 14.2h22" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const links = [
  { href: "/", label: "Map", short: "Map" },
  { href: "/upload", label: "Report water", short: "Report" },
  { href: "/about", label: "How it works", short: "About" },
];

export default function Header() {
  const path = usePathname();
  const theme = useTheme();
  return (
    <header className="h-12 shrink-0 border-b border-line bg-panel flex items-center justify-between px-3 sm:px-4 relative z-30">
      <Link href="/" title={TAGLINE} className="flex items-center gap-2 text-text">
        <Mark />
        <span className="font-display text-[22px] leading-none tracking-tight">{BRAND}</span>
      </Link>
      <nav className="flex items-center gap-0.5 sm:gap-1 text-[13px]">
        {links.map((l) => {
          const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`px-2 sm:px-2.5 py-1.5 rounded-md transition-colors ${active ? "text-text bg-panel-2" : "text-muted hover:text-text"}`}
            >
              <span className="sm:hidden">{l.short}</span>
              <span className="hidden sm:inline">{l.label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          className="ml-1 w-8 h-8 rounded-md text-muted hover:text-text hover:bg-panel-2 flex items-center justify-center"
        >
          {theme === "dark" ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
            </svg>
          )}
        </button>
      </nav>
    </header>
  );
}
