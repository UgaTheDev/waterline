import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import Responder from "@/components/Responder";

// Not linked from the public header; reached from About → For responders.
export const metadata: Metadata = { title: `Responder mode · ${BRAND}`, robots: { index: false, follow: false } };

export default function ResponderPage() {
  return <Responder />;
}
