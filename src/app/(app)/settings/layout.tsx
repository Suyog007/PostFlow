import type { ReactNode } from "react";
import { SettingsList } from "./settings-list";
import { SettingsShell } from "./settings-shell";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsShell list={<SettingsList />}>{children}</SettingsShell>;
}
