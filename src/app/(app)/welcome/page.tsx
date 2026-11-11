import type { Metadata } from "next";
import { requireActiveUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { WelcomeForm } from "@/components/welcome-form";

export const metadata: Metadata = { title: "Welcome · PostFlow" };
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const user = await requireActiveUser();
  const s = await getSettings();
  const first = (s.profile.name || user.name || "").split(/\s+/).filter((w) => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w))[0] ?? "";
  return <WelcomeForm name={first} field={s.profile.field} audience={s.profile.audience} role={s.profile.role} expertise={s.profile.expertise.join(", ")} region={s.profile.region} />;
}
