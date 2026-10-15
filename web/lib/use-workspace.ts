"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { FindingsResponse, InvestigationResponse, TimelineResponse } from "./types";

/** Every async view is in exactly one of these states. "unavailable" is never "no pattern". */
export type Loadable<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "unavailable"; message: string };

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { detail?: unknown } | null;
    const detail = typeof body?.detail === "string" ? body.detail : null;
    return detail ? `${detail} (HTTP ${err.status})` : `The evaluation service answered HTTP ${err.status}.`;
  }
  return "The evaluation service could not be reached.";
}

export function useWorkspace(pid: string) {
  const [timeline, setTimeline] = useState<Loadable<TimelineResponse>>({ kind: "loading" });
  const [findings, setFindings] = useState<Loadable<FindingsResponse>>({ kind: "loading" });
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    const [t, f] = await Promise.allSettled([api.timeline(pid), api.findings(pid)]);
    setTimeline(t.status === "fulfilled" ? { kind: "ready", data: t.value } : { kind: "unavailable", message: describeError(t.reason) });
    setFindings(f.status === "fulfilled" ? { kind: "ready", data: f.value } : { kind: "unavailable", message: describeError(f.reason) });
    setVersion((v) => v + 1);
  }, [pid]);

  useEffect(() => {
    setTimeline({ kind: "loading" });
    setFindings({ kind: "loading" });
    void reload();
  }, [reload]);

  return { timeline, findings, reload, version };
}

export function useInvestigation(fid: string | null, version: number): Loadable<InvestigationResponse> | null {
  const [state, setState] = useState<Loadable<InvestigationResponse> | null>(null);

  useEffect(() => {
    if (!fid) {
      setState(null);
      return;
    }
    let live = true;
    setState((prev) => (prev?.kind === "ready" && prev.data.finding.id === fid ? prev : { kind: "loading" }));
    api.investigation(fid).then(
      (data) => live && setState({ kind: "ready", data }),
      (err) => live && setState({ kind: "unavailable", message: describeError(err) }),
    );
    return () => {
      live = false;
    };
  }, [fid, version]);

  return state;
}
