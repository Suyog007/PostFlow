import type { Metadata } from "next";
import { requireActiveUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/ui";
import { WelcomeForm } from "@/components/welcome-form";

export const metadata: Metadata = { title: "Welcome · PostFlow" };
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  await requireActiveUser();
  const s = await getSettings();
  return (
    <div className="max-w-[720px]">
      <PageHeader
        title="Two questions before your first post"
        description="PostFlow writes from the news in your field. Tell it what your field is, so the stories it picks are ones you can speak about, not the same headlines everyone else gets."
      />
      <WelcomeForm field={s.profile.field} audience={s.profile.audience} role={s.profile.role} expertise={s.profile.expertise.join(", ")} region={s.profile.region} />
    </div>
  );
}
