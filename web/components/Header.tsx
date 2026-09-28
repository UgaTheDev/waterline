"use client";
import { BRAND } from "@/lib/brand";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { USE_MOCK } from "@/lib/api";
import { setLang, useLang, useT, type Key } from "@/lib/i18n";
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

const links: { href: string; label: Key; short: Key }[] = [
  { href: "/", label: "nav.map", short: "nav.mapShort" },
  { href: "/upload", label: "nav.report", short: "nav.reportShort" },
  { href: "/drive", label: "nav.drive", short: "nav.driveShort" },
  { href: "/about", label: "nav.about", short: "nav.aboutShort" },
];

export default function Header() {
  const path = usePathname();
  const theme = useTheme();
  const lang = useLang();
  const t = useT();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  // Phone widths are tight (390 px): the brand, link padding and icon buttons shrink below sm, and Spanish short labels stay short.
  return (
    <>
    {USE_MOCK && (
      <div role="status" className="bg-warn-soft text-warn text-center text-xs py-1.5 px-4 font-medium">
        {t("mock.banner")}
      </div>
    )}
    <header className="h-12 shrink-0 border-b border-line bg-panel flex items-center justify-between gap-1 px-3 sm:px-4 relative z-30">
      <Link href="/" title={t("tagline")} className="flex items-center gap-1.5 sm:gap-2 text-text min-w-0">
        <Mark />
        <span className="font-display text-[19px] sm:text-[22px] leading-none tracking-tight max-[350px]:hidden">{BRAND}</span>
      </Link>
      <nav className="flex items-center gap-0 sm:gap-1 text-[12.5px] sm:text-[13px]">
        {links.map((l) => {
          const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`px-1.5 sm:px-2.5 py-1.5 rounded-md whitespace-nowrap transition-colors ${active ? "text-text bg-panel-2" : "text-muted hover:text-text"}`}
            >
              <span className="sm:hidden">{t(l.short)}</span>
              <span className="hidden sm:inline">{t(l.label)}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setLang(lang === "es" ? "en" : "es")}
          aria-label={t("lang.switch")}
          title={t("lang.switch")}
          lang={lang === "es" ? "en" : "es"}
          className="ml-0.5 sm:ml-1 w-7 sm:w-8 h-8 rounded-md font-mono text-[11px] tracking-wide text-muted hover:text-text hover:bg-panel-2 flex items-center justify-center"
        >
          {t("lang.code")}
        </button>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={t(theme === "dark" ? "theme.toLight" : "theme.toDark")}
          className="w-7 sm:w-8 h-8 rounded-md text-muted hover:text-text hover:bg-panel-2 flex items-center justify-center"
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
    </>
  );
}
