import { LaunchWizard } from "@/components/LaunchWizard";

export default async function LaunchPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return <LaunchWizard resumeId={id} />;
}
