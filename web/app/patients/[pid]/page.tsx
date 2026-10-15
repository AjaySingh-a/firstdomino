import { Workspace } from "@/components/workspace";

export default async function PatientPage({ params }: { params: Promise<{ pid: string }> }) {
  const id = decodeURIComponent((await params).pid);
  return <Workspace key={id} pid={id} />;
}
