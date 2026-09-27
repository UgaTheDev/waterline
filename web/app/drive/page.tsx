import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import Drive from "@/components/Drive";

export const metadata: Metadata = { title: `Drive mode · ${BRAND}` };

export default function DrivePage() {
  return (
    <div className="drive-page flex-1 flex flex-col min-h-0">
      <Drive />
    </div>
  );
}
