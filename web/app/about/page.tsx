import { BRAND } from "@/lib/brand";
import type { Metadata } from "next";
import About from "@/components/About";

export const metadata: Metadata = { title: `How it works · ${BRAND}` };

export default function AboutPage() {
  return <About />;
}
