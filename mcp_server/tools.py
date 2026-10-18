"""What each MCP tool says. Every result is plain text that ends with the evidence IDs it rests on.

The text comes from deterministic templates over API responses; nothing here creates or changes a
finding. Wording follows the copy rules: possible pattern, on record, not known yet, the clinician decides.
"""

from __future__ import annotations

from typing import Any

from .client import ApiError, FirstDominoAPI

STATUS = {
    "candidate": "Possible pattern",
    "needs_evidence": "Needs evidence",
    "competing_explanation": "Another explanation is on record",
    "needs_reassessment": "Needs a fresh look (the record changed after review)",
    "reviewed": "Reviewed by a clinician",
    "not_matched": "No longer matches the pattern",
}
STATE = {
    "documented": "documented",
    "reported": "reported by the caregiver",
    "conflicting": "sources disagree",
    "unknown": "not known yet",
    "not_available": "not available (this is not a no)",
}
OPEN = {"candidate", "needs_evidence", "competing_explanation", "needs_reassessment"}
NO_CHAIN_NOTE = (
    "FirstDomino models one curated pattern, so no chain here does not rule anything else out. "
    "A clinician still reviews the whole medicine list."
)
FOOTER = "Synthetic data. A possible pattern for a clinician to review, not a conclusion."


def patient_of(scoped_id: str) -> str:
    """IDs are patient-scoped: "<patient_id>:<local id>"."""
    return scoped_id.split(":", 1)[0]


def reply(lines: list[str], ids: list[str | None]) -> str:
    seen = list(dict.fromkeys(i for i in ids if i))
    return "\n".join([*lines, "", FOOTER, f"Evidence IDs: {', '.join(seen) if seen else 'none'}"])


def _value(ref: dict[str, Any]) -> str:
    v = ref["value"]
    if v is None:
        return "not known yet"
    if ref["field"] in {"happened_at", "stop_day"} and isinstance(v, int):
        return f"day {v}"
    return str(v)


def _facts(title: str, refs: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    if not refs:
        return [], []
    lines, ids = [f"{title}:"], []
    for r in refs:
        lines.append(
            f"- {r['label']}: {_value(r)} ({STATE.get(r['state'], r['state'])}; "
            f"sources {', '.join(r['source_ids']) or 'none'}) [{r['fact_id']}]"
        )
        ids += [r["fact_id"], r.get("requirement_id"), *r["source_ids"]]
    return lines, ids


def _question(q: dict[str, Any]) -> str:
    asked = f", asked on day {q['asked_at']}" if q.get("asked_at") is not None else ", not asked yet"
    return f'Ask the {q["ask_role"]}{asked}: "{q["text"]}" [{q["id"]}]'


def _pack_body(item: dict[str, Any]) -> tuple[list[str], list[str]]:
    """The shared middle of an evidence pack and a packet item: pattern, facts, reviews."""
    f, p = item["finding"], item["pattern"]
    lines = [
        f"{f['headline']} [{f['id']}]",
        f"Status: {STATUS.get(f['status'], f['status'])} (revision {f['revision_n']})",
        f"Pattern: {p['title']} (window {p['window_days']} days) [{p['id']} v{p['version']}]",
    ]
    for ref in p["evidence_refs"][:1]:
        lines.append(f"Citation: {ref['citation']}" + (f" doi:{ref['doi']}" if ref.get("doi") else ""))
    ids = [f["id"], p["id"], f["index_episode_id"], f["marker_episode_id"], *f["observation_ids"]]
    for title, key in (
        ("On record", "documented"),
        ("Sources disagree", "conflicts"),
        ("Not known yet", "unknowns"),
    ):
        more, more_ids = _facts(title, item[key])
        lines += more
        ids += more_ids
    for d in item["decisions"]:
        lines.append(
            f"Review by the {d['by_role']} on day {d['decided_at']} (revision {d['revision_n']}): "
            f'{d["decision"].replace("_", " ")}. "{d["reason"]}" [{d["id"]}]'
        )
        ids.append(d["id"])
    return lines, ids


# ---------- read tools ----------


def list_stories(api: FirstDominoAPI) -> str:
    lines, ids = ["Synthetic stories in FirstDomino:"], []
    patients = api.get("/patients")
    # Visitor-built lab patients (lab-...) are not stories; the web app lists them apart too.
    lab = [p for p in patients if p["id"].startswith("lab-")]
    for p in (p for p in patients if not p["id"].startswith("lab-")):
        found = api.get(f"/patients/{p['id']}/findings")
        lines.append(f"- {p['label']} [{p['id']}], age {p['age_band']}, case version {p['case_version']}")
        ids.append(p["id"])
        for f in found["findings"]:
            lines.append(f"    {f['headline']}. Status: {STATUS.get(f['status'], f['status'])} [{f['id']}]")
            ids.append(f["id"])
        if not found["findings"]:
            lines.append("    No matched pattern. " + NO_CHAIN_NOTE)
    if lab:
        lines.append(f"Also {len(lab)} visitor-built lab patient(s) (lab-...), not listed here.")
    return reply(lines, ids)


def get_evidence_pack(api: FirstDominoAPI, finding_id: str) -> str:
    inv = api.get(f"/findings/{finding_id}/investigation")
    lines, ids = _pack_body(inv)
    if inv["next_question"]:
        lines.append("Next question: " + _question(inv["next_question"]))
        ids += [inv["next_question"]["id"], inv["next_question"]["requirement_id"]]
    lines.append("Sources:")
    for s in inv["sources"]:
        lines.append(f"- {s['label']}, recorded on day {s['recorded_at']} [{s['id']}]")
        ids.append(s["id"])
    return reply([f"Evidence pack, case version {inv['case_version']}", *lines], ids)


def _hop(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> str:
    """A path as text in path order, each relationship written in its stored direction."""
    out = [nodes[0]["name"]]
    for e, n in zip(edges, nodes[1:], strict=True):
        out.append(f"-[:{e['type']}]->" if e["forward"] else f"<-[:{e['type']}]-")
        out.append(n["name"])
    return " ".join(out)


def explain_path(api: FirstDominoAPI, finding_id: str) -> str:
    p = api.get(f"/findings/{finding_id}/path")
    walk = p["walk"]
    how = "FalkorDB returned it (q11)" if p["mode"] == "live" else "built from the story file (fixture mode)"
    lines = [f"The path behind {finding_id}, as {how}:", _hop(walk["nodes"], walk["edges"])]
    for side in p["sides"]:
        lines.append("Symptom: " + _hop(side["nodes"], side["edges"]))
    lines.append("The path shows how these facts are linked. The rules set the status: a possible pattern.")
    ids = [finding_id] + [n["id"] for path in [walk, *p["sides"]] for n in path["nodes"]]
    return reply(lines, ids)


def next_missing_fact(api: FirstDominoAPI, patient_id: str) -> str:
    found = api.get(f"/patients/{patient_id}/findings")
    lines, ids = [f"Next missing fact for {patient_id} (case version {found['case_version']}):"], [patient_id]
    asked = 0
    for f in found["findings"]:
        if f["status"] not in OPEN:
            continue
        inv = api.get(f"/findings/{f['id']}/investigation")
        q = inv["next_question"]
        if not q:
            continue
        asked += 1
        fact = next(
            (u for u in inv["unknowns"] + inv["conflicts"] if u["requirement_id"] == q["requirement_id"]),
            None,
        )
        lines.append(f"- For {f['headline']} [{f['id']}]")
        if fact:
            lines.append(
                f"  Missing: {fact['label']} ({STATE.get(fact['state'], fact['state'])}) [{fact['fact_id']}]"
            )
            ids.append(fact["fact_id"])
        lines.append(f"  {_question(q)}")
        lines.append(f"  Requirement: [{q['requirement_id']}]")
        ids += [f["id"], q["id"], q["requirement_id"]]
        if q.get("asked_at") is not None:
            # From memory: the question is already a node in the graph; cite the step that asked it.
            steps = api.get(f"/patients/{patient_id}/agent-steps")["steps"]
            earlier = next((s for s in steps if s["ok"] and q["id"] in s["result_ids"]), None)
            where = f", step [{earlier['id']}]" if earlier else ""
            lines.append(
                f"  From memory: already asked on day {q['asked_at']}{where}; still waiting for the "
                f"{q['ask_role']}, so it is not asked again."
            )
            ids += [earlier["id"]] if earlier else []
        if fact:
            lines.append(
                f"  To see every finding that depends on this fact: "
                f'which_findings_depend_on("{patient_id}", "{fact["fact_id"]}")'
            )
    if not asked:
        lines.append("No open finding is waiting on a missing fact right now.")
    return reply(lines, ids)


def inspect_episode(api: FirstDominoAPI, episode_id: str) -> str:
    pid = patient_of(episode_id)
    tl = api.get(f"/patients/{pid}/timeline")
    ep = next((e for e in tl["episodes"] if e["id"] == episode_id), None)
    if ep is None:
        known = ", ".join(e["id"] for e in tl["episodes"])
        raise ApiError(f"No medication episode {episode_id}. Episodes for {pid}: {known}.", 404)
    ing = ep["ingredient"]
    sources = {s["id"]: s for s in tl["sources"]}
    started = f"day {ep['happened_at']}" if ep["happened_at"] is not None else "not known yet"
    lines = [
        f"Medication episode [{ep['id']}]",
        f"Medicine: {ing['name']} (class {ing['drug_class']}, RxCUI {ing['rxcui']}), {ep['dose_text']}",
        f"Started: {started} ({STATE.get(ep['state'], ep['state'])}); recorded on day {ep['recorded_at']}",
        f"Stopped: {'day ' + str(ep['stop_day']) if ep['stop_day'] is not None else 'no stop on record'}",
        f"Reason on record: {ep['indication'] or 'none'} "
        f"({STATE.get(ep['indication_state'], ep['indication_state'])})",
        f"Prescriber: {(ep['prescriber_specialty'] or 'not known yet').replace('_', ' ')}",
        "Sources:",
        *[f"- {sources[s]['label'] if s in sources else s} [{s}]" for s in ep["source_ids"]],
    ]
    ids = [ep["id"], *ep["source_ids"]]
    roles = []
    for f in api.get(f"/patients/{pid}/findings")["findings"]:
        if episode_id in (f["index_episode_id"], f["marker_episode_id"]):
            role = "first medicine" if f["index_episode_id"] == episode_id else "second medicine"
            roles.append(
                f"- {role} in: {f['headline']}. Status: {STATUS.get(f['status'], f['status'])} [{f['id']}]"
            )
            ids.append(f["id"])
    lines += ["Findings that use this episode:", *(roles or ["- none"])]
    return reply(lines, ids)


def which_findings_depend_on(api: FirstDominoAPI, patient_id: str, fact_id: str) -> str:
    res = api.get(f"/patients/{patient_id}/facts/{fact_id}/affected")
    lines = [f"Findings that depend on [{fact_id}] (case version {res['case_version']}):"]
    for f in res["findings"]:
        lines.append(f"- {f['headline']}. Status: {STATUS.get(f['status'], f['status'])} [{f['id']}]")
    if not res["findings"]:
        lines.append("- none. Changing this fact would not change any finding.")
    else:
        lines.append("If this fact changes, only these findings are evaluated again.")
    return reply(lines, [fact_id, *(f["id"] for f in res["findings"])])


def prepare_packet(api: FirstDominoAPI, patient_id: str) -> str:
    pk = api.get(f"/patients/{patient_id}/packet")
    p = pk["patient"]
    lines = [
        f"Review packet: {p['label']} [{p['id']}], age {p['age_band']}, as of day {p['as_of_day']}, "
        f"case version {pk['case_version']}",
        pk["disclaimer"],
    ]
    ids = [p["id"]]
    for n, item in enumerate(pk["items"], 1):
        body, more = _pack_body(item)
        lines += ["", f"{n}. " + body[0], *body[1:]]
        ids += more
        for q in item["open_questions"]:
            lines.append("Open question: " + _question(q))
            ids += [q["id"], q["requirement_id"]]
    if not pk["items"]:
        lines.append("No matched pattern for this patient. " + NO_CHAIN_NOTE)
    return reply(lines, ids)


# ---------- write tools (FD_MCP_ALLOW_WRITES=1, synthetic stories only) ----------


def require_synthetic(api: FirstDominoAPI, pid: str) -> int:
    """Writes are allowed on the synthetic demo stories only. Returns the current case version."""
    patient = next((p for p in api.get("/patients") if p["id"] == pid), None)
    if not pid.startswith("syn-") or patient is None or patient.get("synthetic") is not True:
        raise ApiError(f"Writes are limited to the synthetic stories; {pid} is not one of them.", 403)
    return patient["case_version"]


def ask_question(api: FirstDominoAPI, requirement_id: str) -> str:
    pid = patient_of(requirement_id)
    version = require_synthetic(api, pid)
    res = api.post("/questions", {"case_version": version, "requirement_id": requirement_id})
    q = res["question"]
    lines = [
        ("This question was already on record:" if res["replayed"] else "Question recorded as asked:"),
        _question(q),
        f"Case version is now {res['case_version']}. "
        "The answer is up to the person asked; until then it stays not known yet.",
    ]
    return reply(lines, [q["id"], q["requirement_id"]])


def run_review_agent(api: FirstDominoAPI, finding_id: str) -> str:
    pid = patient_of(finding_id)
    version = require_synthetic(api, pid)
    res = api.post(f"/findings/{finding_id}/review-agent", {"case_version": version})
    lines = [f"Review agent pass on [{finding_id}] (phrasing: {res['phrasing']}):"]
    ids: list[str | None] = [finding_id]
    for s in res["steps"]:
        lines.append(f"- {s['tool']}: {'ok' if s['ok'] else 'did not complete'} [{s['id']}]")
        ids += [s["id"], *s["result_ids"]]
    if res["question"]:
        lines.append("Question: " + _question(res["question"]))
        ids.append(res["question"]["id"])
    if res["packet_text"]:
        lines += ["Packet text:", res["packet_text"]]
    lines.append(f"Case version is now {res['case_version']}. The agent never creates or changes findings.")
    return reply(lines, ids)
