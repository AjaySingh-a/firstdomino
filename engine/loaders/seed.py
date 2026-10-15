"""Seed FalkorDB: kb_template, then one family graph with synthetic stories. Owner: Dev.

1. kb_template gets the curated patterns (data/patterns/) and only the ingredients, classes and
   effects the chosen stories need.
2. family_<id> starts as a GRAPH.COPY of kb_template (or has the same knowledge MERGEd in if it
   already exists), then each story is loaded as nodes and evaluated by engine/rules.py. A story's
   earlier review decisions and its unconfirmed (pending) evidence are loaded as they are.
3. A patient that is already in the family graph is never reloaded: the graph is the record, and
   evidence confirmed since must not be overwritten by the fixture. Use --reset to start over.

Every write is a named MERGE query (engine/queries/write/), so loading twice changes nothing.

    uv run python -m engine.loaders.seed [--reset] [--family demo] [--stories 1 2 3]
"""

from __future__ import annotations

import argparse
import json
import sys

from falkordb import FalkorDB, Graph

from api.models import AgentStep, MedicationEpisode, Observation, Pattern, StoryFixture
from api.store import load_patterns, load_stories
from engine.db import KB_GRAPH, connect, family_graph, props, run
from engine.evaluate import evaluate_patient

DEFAULT_FAMILY = "demo"


def _graph_exists(db: FalkorDB, name: str) -> bool:
    return name in db.list_graphs()


def _drop(db: FalkorDB, name: str) -> None:
    if _graph_exists(db, name):
        db.select_graph(name).delete()


def load_knowledge(graph: Graph, patterns: list[Pattern], stories: list[StoryFixture]) -> None:
    ingredients = {ep.ingredient.name: ep.ingredient for s in stories for ep in s.episodes}
    for ing in sorted(ingredients.values(), key=lambda i: i.name):
        run(graph, "write/kb_ingredient", name=ing.name, rxcui=ing.rxcui, drug_class=ing.drug_class)
    effects = {o.effect for s in stories for o in s.observations} | {p.via_effect for p in patterns}
    for name in sorted(effects):
        run(graph, "write/kb_effect", name=name)
    for p in patterns:
        run(
            graph, "write/kb_pattern", id=p.id, version=p.version, title=p.title,
            window_days=p.window_days, requires=list(p.requires),
            evidence_refs=json.dumps([r.model_dump() for r in p.evidence_refs]),
            index_class=p.index_class, via_effect=p.via_effect, marker_class=p.marker_class,
        )


def fact_props(fact: MedicationEpisode | Observation) -> dict:
    """The properties a fact node stores (relationships hold the rest). None removes a property."""
    if isinstance(fact, MedicationEpisode):
        return fact.model_dump(exclude={"id", "ingredient", "source_ids", "prescriber_specialty"})
    return fact.model_dump(exclude={"id", "effect", "source_ids"})


def load_story(graph: Graph, story: StoryFixture) -> None:
    pid = story.patient.id
    run(graph, "write/patient", pid=pid, props=story.patient.model_dump(exclude={"id"}))
    for s in story.sources:
        run(graph, "write/source", pid=pid, id=s.id, props=s.model_dump(exclude={"id"}))
    for ep in story.episodes:
        run(graph, "write/episode", pid=pid, id=ep.id, props=fact_props(ep), ingredient=ep.ingredient.name)
        run(graph, "write/fact_sources", pid=pid, id=ep.id, source_ids=ep.source_ids)
        if ep.prescriber_specialty:
            run(
                graph, "write/prescriber", pid=pid, ep_id=ep.id,
                id=f"{pid}:prs-{ep.prescriber_specialty}", specialty=ep.prescriber_specialty,
            )
    for o in story.observations:
        run(graph, "write/observation", pid=pid, id=o.id, props=fact_props(o), effect=o.effect)
        run(graph, "write/fact_sources", pid=pid, id=o.id, source_ids=o.source_ids)


def agent_step_props(step: AgentStep) -> dict:
    """FalkorDB properties hold no maps, so args is stored as JSON. FOR links the finding."""
    args_json = json.dumps(step.args, sort_keys=True)
    return {**step.model_dump(exclude={"args", "finding_id"}), "args_json": args_json}


def load_history(graph: Graph, story: StoryFixture) -> None:
    """What happened before the story's as_of_day: review decisions, the review agent's steps and
    unconfirmed evidence."""
    pid = story.patient.id
    for d in story.decisions:
        run(
            graph, "write/seed_decision", pid=pid, fid=d.finding_id, id=d.id, revision_n=d.revision_n,
            by_role=d.by_role, decision=d.decision, reason=d.reason, decided_at=d.decided_at,
        )
    for step in story.agent_steps:
        run(
            graph, "write/agent_step", pid=pid, case_version=story.patient.case_version, id=step.id,
            fid=step.finding_id, props=agent_step_props(step),
        )
    for e in story.pending_evidence:
        run(
            graph, "write/evidence_pending", pid=pid, event_id=e.event_id, case_version=e.case_version,
            change=e.change.model_dump_json(),
        )


def seed(
    db: FalkorDB,
    family_id: str,
    stories: list[StoryFixture],
    patterns: list[Pattern],
    *,
    reset: bool = False,
    kb_name: str = KB_GRAPH,
) -> Graph:
    fam_name = family_graph(family_id)
    if reset:
        _drop(db, kb_name)
        _drop(db, fam_name)
    load_knowledge(db.select_graph(kb_name), patterns, stories)
    if _graph_exists(db, fam_name):
        load_knowledge(db.select_graph(fam_name), patterns, stories)  # keep knowledge in sync
    else:
        db.select_graph(kb_name).copy(fam_name)
    fam = db.select_graph(fam_name)
    present = {props(r["p"])["id"] for r in run(fam, "admin/patients_in_graph")}
    for story in stories:
        if story.patient.id in present:
            continue
        load_story(fam, story)
        first = next((r.created_at for r in story.revisions if r.n == 1), story.patient.as_of_day)
        evaluate_patient(fam, story.patient.id, first)
        load_history(fam, story)
    return fam


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="engine.loaders.seed")
    ap.add_argument("--reset", action="store_true", help="drop kb_template and the family graph first")
    ap.add_argument("--family", default=DEFAULT_FAMILY)
    ap.add_argument("--stories", nargs="+", type=int, default=[1], help="story numbers (default: 1)")
    args = ap.parse_args(argv)

    by_number = {s.story_id.removeprefix("story-"): s for s in load_stories().values()}
    stories = [by_number[str(n)] for n in args.stories]
    patterns = list(load_patterns().values())
    fam = seed(connect(), args.family, stories, patterns, reset=args.reset)
    for s in stories:
        rows = run(fam, "q6_patient_findings", pid=s.patient.id)
        found = ", ".join(f"{r['f'].properties['id']} [{r['f'].properties['status']}]" for r in rows)
        print(f"{s.patient.id} -> {fam.name}: {found or 'no findings'} [SYNTHETIC]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
