"""The patient lab: a visitor builds a synthetic patient, and it is loaded into FalkorDB and evaluated
by engine/rules.py exactly like the three stories. Owner: Dev.

Nothing here decides a finding. This module only turns the visitor's choices into a StoryFixture
(patient, sources, medication episodes, one optional symptom) with patient-scoped IDs. The graph store
loads it with the same named write queries the seeder uses, and Q1 + the rules do the rest.
"""

from __future__ import annotations

import json
import secrets
from functools import lru_cache

from api.models import (
    LabPalette,
    LabRequest,
    MedicationEpisode,
    Observation,
    PaletteMedicine,
    Patient,
    Source,
    StoryFixture,
)
from api.store import DATA_DIR, Invalid, load_patterns

PREFIX = "lab-"
MAX_DAY = 730


@lru_cache(maxsize=1)
def _palette_file() -> dict:
    return json.loads((DATA_DIR / "lab" / "palette.json").read_text(encoding="utf-8"))


def palette() -> LabPalette:
    raw = _palette_file()
    return LabPalette(
        medicines=[PaletteMedicine(**m) for m in raw["medicines"]],
        symptoms=[s["label"] for s in raw["symptoms"]],
        patterns=list(load_patterns().values()),
    )


def _effect_of(label: str) -> str:
    for s in _palette_file()["symptoms"]:
        if s["label"] == label:
            return s["effect"]
    raise Invalid(f"unknown symptom {label!r}")


def _day(day: int | None, state: str, what: str) -> tuple[int | None, str]:
    """A day and its state, made consistent: an unknown state has no day, and no day means unknown."""
    if day is not None and not 0 <= day <= MAX_DAY:
        raise Invalid(f"{what}: day must be between 0 and {MAX_DAY}")
    if state == "unknown" or day is None:
        return None, "unknown"
    return day, state


def new_patient_id() -> str:
    return PREFIX + secrets.token_hex(3)


def build_story(req: LabRequest, pid: str) -> StoryFixture:
    by_name = {m.name: m for m in palette().medicines}
    names = [m.name for m in req.medicines]
    if len(set(names)) != len(names):
        raise Invalid("each medicine can be placed once")
    for n in names:
        if n not in by_name:
            raise Invalid(f"{n!r} is not in the lab's medicine list")

    meds = [(m, *_day(m.start_day, m.start_state, m.name)) for m in req.medicines]
    symptom = None
    if req.symptom is not None:
        symptom = (req.symptom, *_day(req.symptom.onset_day, req.symptom.state, req.symptom.label))
    days = [d for _, d, _ in meds if d is not None]
    if symptom and symptom[1] is not None:
        days.append(symptom[1])
    as_of = max(days, default=0) + 7

    record = Source(
        id=f"{pid}:src-record", patient_id=pid, kind="pharmacy_record",
        label="Medicine record entered in the patient lab (synthetic)", happened_at=None, recorded_at=as_of,
    )
    caregiver = Source(
        id=f"{pid}:src-caregiver", patient_id=pid, kind="caregiver_report",
        label="What the caregiver said, entered in the patient lab (synthetic)",
        happened_at=as_of, recorded_at=as_of,
    )

    def sources_for(*states: str) -> list[str]:
        out = []
        if "documented" in states:
            out.append(record.id)
        if "reported" in states:
            out.append(caregiver.id)
        return out or [record.id]

    episodes = []
    for m, day, state in meds:
        p = by_name[m.name]
        reason = (m.reason or "").strip() or None
        reason_state = m.reason_state if reason else "unknown"
        if reason and reason_state == "unknown":
            raise Invalid(f"{m.name}: say whether the reason is documented or reported by the caregiver")
        episodes.append(MedicationEpisode(
            id=f"{pid}:ep-{m.name}", patient_id=pid, happened_at=day,
            recorded_at=day if state == "documented" else as_of, state=state,
            source_ids=sources_for(state, reason_state),
            ingredient={"name": p.name, "rxcui": p.rxcui, "drug_class": p.drug_class},
            dose_text=p.dose_text, indication=reason, indication_state=reason_state, stop_day=None,
            prescriber_specialty=None,
        ))

    observations = []
    if symptom:
        s, day, state = symptom
        slug = s.label.lower().replace(" ", "-")
        observations.append(Observation(
            id=f"{pid}:obs-{slug}", patient_id=pid, happened_at=day, recorded_at=as_of, state=state,
            source_ids=sources_for(state), label=s.label, effect=_effect_of(s.label),
        ))

    used = {sid for f in [*episodes, *observations] for sid in f.source_ids}
    return StoryFixture(
        synthetic=True, story_id=pid, title=f"SYNTHETIC - built in the patient lab ({pid})",
        notes=["SYNTHETIC PATIENT. Built by a visitor in the FirstDomino patient lab."],
        patient=Patient(
            id=pid, label=f"Lab patient {pid.removeprefix(PREFIX)}", age_band="75-79",
            case_version=1, as_of_day=as_of,
        ),
        sources=[s for s in (record, caregiver) if s.id in used],
        episodes=episodes, observations=observations, findings=[], requirements=[], questions=[],
        revisions=[], decisions=[], agent_steps=[], pending_evidence=[],
    )
