import { Workspace } from "@/components/workspace";

export default async function PatientPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  return <Workspace pid={decodeURIComponent(pid)} />;
}
