import type { ReactNode } from "react";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[1180px]">{children}</div>;
}
