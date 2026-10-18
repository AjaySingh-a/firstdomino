import { Packet } from "@/components/packet";
import { pageMeta } from "@/lib/meta";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  return pageMeta(`Review packet · ${id}`, "What a clinician would read: timeline, open questions, possible patterns and how certain each fact is. Synthetic data.");
}

export default async function PacketPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  return <Packet key={id} pid={id} />;
}
