import { Packet } from "@/components/packet";

export default async function PacketPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  return <Packet key={id} pid={id} />;
}
