import { Workspace } from "@/components/workspace";
import { pageMeta } from "@/lib/meta";
import { STORY_TITLES } from "@/lib/present";

export async function generateMetadata({ params }: { params: Promise<{ pid: string }> }) {
  const id = decodeURIComponent((await params).pid);
  return pageMeta(
    STORY_TITLES[id] ? `Story · ${STORY_TITLES[id]}` : `Review · ${id}`,
    "A synthetic patient's medication review: the timeline, the possible pattern and the one missing fact.",
  );
}

export default async function PatientPage({ params }: { params: Promise<{ pid: string }> }) {
  const id = decodeURIComponent((await params).pid);
  return <Workspace key={id} pid={id} />;
}
