import { notFound } from "next/navigation";
import { getCollection } from "@/lib/store";
import { CollectionMint } from "@/components/CollectionMint";

export const dynamic = "force-dynamic";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const collection = await getCollection(id);
  if (!collection) notFound();
  return <CollectionMint initial={collection} />;
}
