"""Deterministic question text for an open EvidenceRequirement. The agent may rephrase it later;
this template is the fallback and never adds facts that are not already in the graph."""

from __future__ import annotations

from api.models import AskRole, Question

# kind -> (who to ask, template). {name} is the medicine or observation, {day} its known day.
TEMPLATES: dict[str, tuple[AskRole, str]] = {
    "indication": (
        "caregiver",
        "Do you know why {name} was started{around}? A letter, a prescription note, or what the "
        "doctor said at the time would help.",
    ),
    "onset_day": (
        "caregiver",
        "When did you first notice the {name}? A rough day, or a note from a visit, would help.",
    ),
    "start_day": (
        "prescriber",
        "On which day was {name} started? A pharmacy record or clinic letter would help.",
    ),
    "order": (
        "prescriber",
        "Can the day for {name} be confirmed from a record? The order of events is not settled yet.",
    ),
}


def question_for(pid: str, requirement_id: str, kind: str, name: str, day: int | None) -> Question:
    role, template = TEMPLATES[kind]
    around = f" around day {day}" if day is not None else ""
    local = requirement_id.split(":", 1)[1].removeprefix("req-")
    return Question(
        id=f"{pid}:q-{local}", patient_id=pid, requirement_id=requirement_id, ask_role=role,
        text=template.format(name=name, around=around), asked_at=None, answer=None, answer_state=None,
    )
