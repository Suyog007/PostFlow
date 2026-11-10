import { SectionView } from "../section-view";

export default async function SettingsSectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ ok?: string; error?: string; connected?: string }> }) {
  const { section } = await params;
  const sp = await searchParams;
  return <SectionView section={section} ok={sp.ok} error={sp.error} connected={sp.connected} />;
}
