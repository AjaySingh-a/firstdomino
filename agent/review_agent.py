"""The review agent: one bounded pass over one finding, through six allowlisted tools (agent/tools.py).

What it can do: read the finding's evidence, find the next missing fact, record that a question was
asked (POST /questions), see which findings depend on a fact (read-only Q3), and draft the next
conversation to have with the clinician. What it cannot do: answer a question, write evidence,
change a fact, create or change a finding, or record a decision. Only a human sends
POST /patients/{id}/evidence, and only engine/rules.py writes findings.

Each step is one structured-output LLM call that picks a tool, its args and (for ask_question and
prepare_packet) the text. The reply is checked: valid JSON, an allowed tool, args and cited IDs taken
from earlier tool results, and text with no invented day numbers, dates, medicines or reasons and
nothing that breaks the copy rules. A rejected reply, or a 429 / 5xx / timeout, gets one retry; then the
step uses the deterministic plan and templates and records why (`args.fallback_reason`). With no
LLM_API_KEY, after a 401/403/404, or after two steps in a row lost to 429 / 5xx / timeouts, the rest
of the pass uses the templates, so a pass always runs end to end.

Every tool call is persisted as an AgentStep (POST /agent-steps), failures included.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any

from agent.llm import LLM, TRANSIENT, LLMError
from agent.tools import AGENT_TOOLS, TOOL_ARGS, TOOL_HELP, TOOL_MAP
from api.models import (
    AgentStep,
    AgentStepRequest,
    InvestigationResponse,
    PacketItem,
    Question,
    QuestionRequest,
    ReviewAgentResult,
)
from api.store import BANNED_COPY, Conflict, Invalid, NotFound, patient_of

MAX_STEPS = 6
# The deterministic plan: the order the template fallback follows, one call per tool at most.
PLAN = (
    "get_evidence_pack", "inspect_episode", "next_missing_fact", "ask_question", "request_reevaluation",
    "prepare_packet",
)
TEXT_TOOLS = ("ask_question", "prepare_packet")
MAX_TEXT = 600
RETRY_DELAY_S = 1.0  # before retrying after a 429 / 5xx / timeout

STATUS_WORDS = {
    "candidate": "a possible pattern",
    "needs_evidence": "a possible pattern that needs evidence",
    "competing_explanation": "a possible pattern with a competing explanation",
    "needs_reassessment": "a possible pattern that needs a fresh look",
    "reviewed": "a reviewed possible pattern",
    "not_matched": "not a match for the pattern",
}
DECISION_WORDS = {"follow_up": "follow up", "no_action": "no action for now", "defer": "deferred"}

# ---------- what the text checks look for ----------

# A calendar date: a month name next to a number ("3 March", "May 2024"; "day 35 may" is a story
# day), so the verbs "may" and "march" pass; or a relative day.
_MONTH = (
    r"(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|"
    r"oct(ober)?|nov(ember)?|dec(ember)?)"
)
MONTHS = re.compile(
    rf"(?<!day\s)\b\d{{1,4}}(st|nd|rd|th)?\s+(of\s+)?{_MONTH}\b|\b{_MONTH}\.?\s+\d{{1,4}}\b"
    r"|\b(yesterday|tomorrow|last\s+week|next\s+week)\b",
    re.I,
)
# Medicine names: common generic stems, plus names the stems miss.
DRUG_STEM = re.compile(
    r"\b[a-z]+(dipine|pril|sartan|olol|statin|semide|thiazide|tiazide|azole|mycin|cillin|oxacin|"
    r"prazole|gliptin|gliflozin|parin|xaban|gatran|tidine|setron|triptan|lukast|afil|tinib|mab|"
    r"profen|coxib|zepam|zolam|oxetine|triptyline)\b",
    re.I,
)
DRUG_NAMES = frozenset({
    "aspirin", "metformin", "warfarin", "insulin", "ibuprofen", "paracetamol", "acetaminophen",
    "digoxin", "spironolactone", "eplerenone", "gabapentin", "pregabalin", "prednisolone",
    "prednisone", "levothyroxine", "allopurinol", "colchicine", "furosemide", "bumetanide",
    "torasemide", "torsemide", "amlodipine", "nifedipine", "diltiazem", "verapamil", "lisinopril",
    "ramipril", "losartan", "atenolol", "bisoprolol", "metoprolol", "atorvastatin", "simvastatin",
    "omeprazole", "lansoprazole", "tramadol", "codeine", "morphine", "oxycodone", "lithium",
    "hydrochlorothiazide", "indapamide", "chlorthalidone", "doxazosin", "tamsulosin", "donepezil",
    "sertraline", "citalopram", "mirtazapine", "amitriptyline", "quetiapine", "haloperidol",
    "levodopa", "carbidopa", "clopidogrel", "apixaban", "rivaroxaban", "dabigatran", "heparin",
})
CONDITIONS = (
    "hypertension", "high blood pressure", "low blood pressure", "heart failure", "cardiac failure",
    "edema", "oedema", "swelling", "gout", "diabetes", "kidney", "renal", "liver", "angina",
    "arrhythmia", "atrial fibrillation", "cholesterol", "infection", "pain", "insomnia", "depression",
    "anxiety", "asthma", "copd", "stroke", "thyroid", "arthritis", "cancer", "dementia",
    "parkinson", "breathless", "shortness of breath", "cough", "rash", "dizziness", "falls",
    "constipation", "incontinence", "cirrhosis", "lymphedema", "venous insufficiency",
)
CONDITION_RE = [(c, re.compile(rf"\b{re.escape(c)}", re.I)) for c in CONDITIONS]
# A question must not carry its own answer, e.g. "furosemide was started for heart failure, right?"
SUGGESTS_ANSWER = re.compile(
    r"\b(was|is|were|been)\s+(started|prescribed|given|used|taken)\s+(for|to\s+treat|because)\b", re.I
)
NUMBER = re.compile(r"\d+")
# How certain a fact is comes from the record (each fact's state), never from the model's wording.
# Any form of these words: "documented", "confirmation", "reports", "verified", "proven",
# "established", "unknown", "well-known". (The verb "know", as in "Do you know why", is not a claim.)
CERTAINTY = re.compile(
    r"\b(document(s|ed|ing|ation)?|confirm(s|ed|ing|ation)?|unconfirmed|report(s|ed|ing)?|unreported"
    r"|verif(y|ies|ied|ying|ication)|unverified|prov(e|es|ed|en|ing)|unproven"
    r"|establish(es|ed|ing|ment)?|(un|well[-\s]?)?known)\b",
    re.I,
)


class Rejected(Exception):
    """The model's reply broke a rule. `code` is recorded as the step's fallback_reason; the message is
    short and goes back to the model on the retry."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class Choice:
    tool: str
    args: dict[str, str]
    text: str | None
    phrasing: str  # "llm" | "template"
    rejected: list[str] = field(default_factory=list)
    # Why a template step did not use the model: no_key, http_401, http_404, http_429, http_503, timeout,
    # unreachable, invalid_json, invalid_tool, unknown_id, invented_fact, copy_rules.
    fallback_reason: str | None = None


@dataclass
class Seen:
    """Everything the tool results have shown the agent so far. Text may only use what is here."""

    ids: set[str] = field(default_factory=set)
    numbers: set[int] = field(default_factory=set)
    corpus: str = ""

    def absorb(self, data: Any, ids: list[str]) -> None:
        self.ids.update(ids)
        self.corpus += " " + json.dumps(data, ensure_ascii=False).lower().replace("_", " ")
        self._walk(data)

    def _walk(self, x: Any) -> None:
        if isinstance(x, bool) or x is None:
            return
        if isinstance(x, int):
            self.numbers.add(x)
        elif isinstance(x, str):
            if ":" in x and " " not in x:  # an ID: its digits are not facts
                self.ids.add(x)
            else:
                self.numbers.update(int(n) for n in NUMBER.findall(x))
        elif isinstance(x, dict):
            for v in x.values():
                self._walk(v)
        elif isinstance(x, list):
            for v in x:
                self._walk(v)


SYSTEM = """You are the review agent in FirstDomino, a tool for a pharmacist doing a medication review \
of a SYNTHETIC patient. A finding is a possible prescribing pattern for a clinician to review; it is \
never a conclusion about what led to what. The caregiver supplies facts. The clinician decides.

Each turn you pick exactly ONE tool from `allowed_tools` and reply with one JSON object:
{"tool": "<name>", "args": {...}, "text": "<string or null>", "cited_ids": ["<id>", ...]}

Rules:
- `args` holds only the arg names listed for that tool. Every value is an ID that appears in `results`.
- `cited_ids` lists the IDs your text relies on. Every one must appear in `results`.
- `text` is required for ask_question and prepare_packet, and null for every other tool.
- Use only facts in `results`. Never add a day number, a calendar date, a medicine, or a reason a \
medicine was started that is not in `results`. Story time is day numbers ("day 35").
- ask_question: one short, plain question for the person in `ask_role`. Never suggest or assume the \
answer. Never answer it yourself.
- prepare_packet: 2-4 sentences for the clinician: the order of events with their day numbers, which \
fact the review still needs, and which question is open. Say "possible pattern" and "worth reviewing". \
Medicine changes are the prescribing clinician's decision: never advise one, never call a medicine \
harmless, never claim one event led to another.
- Never say how certain a fact is: no "documented", "confirmed", "reported", "verified", "proven", \
"established" or "known" in any form. The record shows each fact's state next to your text.
- You cannot write evidence, change facts, create findings or record decisions.
Reply with the JSON object only."""


class ReviewPass:
    def __init__(self, store, fid: str, llm: LLM | None, llm_off: str | None = None):
        self.store = store
        self.fid = fid
        self.pid = patient_of(fid)
        self.llm = None if llm_off else llm
        # The reason code once the model is given up on for this pass, or why it is off from the start
        # (e.g. "rate_limited", set by the API).
        self.llm_down: str | None = llm_off
        self.transient_steps = 0  # steps in a row lost to 429 / 5xx / timeouts
        self.used: list[str] = []
        self.results: list[dict[str, Any]] = []  # the transcript the model sees
        self.seen = Seen()
        self.inv: InvestigationResponse | None = None
        self.requirement: dict[str, Any] | None = None
        self.fact_ids: set[str] = set()
        self.steps: list[AgentStep] = []
        self.question: Question | None = None
        self.packet_text: str | None = None
        self.phrasings: list[str] = []
        self.memory: str | None = None  # set when an earlier pass already asked the next question
        existing = store.agent_steps(self.pid).steps
        runs = [int(m.group(1)) for s in existing if (m := re.search(r":run-(\d+)-step-", s.id))]
        self.run_n = 1 + max(runs, default=0)

    # ---------- the loop ----------

    def run(self) -> ReviewAgentResult:
        while allowed := self.allowed():
            self.call(self.choose(allowed))
        if not self.phrasings or set(self.phrasings) == {"template"}:
            phrasing = "template"
        else:
            phrasing = "llm" if set(self.phrasings) == {"llm"} else "mixed"
        return ReviewAgentResult(
            finding_id=self.fid, case_version=self.store.findings(self.pid).case_version, steps=self.steps,
            question=self.question, packet_text=self.packet_text, phrasing=phrasing,
        )

    def allowed(self) -> list[str]:
        if "prepare_packet" in self.used or len(self.used) >= MAX_STEPS:
            return []
        if "get_evidence_pack" not in self.used:
            return ["get_evidence_pack"]  # start from the evidence, so every later ID comes from a result
        if self.inv is None:  # the pack failed: there is nothing to reason over, so just close the pass
            return ["prepare_packet"]
        if len(self.used) == MAX_STEPS - 1:
            return ["prepare_packet"]
        open_req = self.requirement is not None and not self.requirement["asked"]
        return [t for t in PLAN if t not in self.used and (t != "ask_question" or open_req)]

    def default(self, allowed: list[str]) -> Choice:
        tool = next(t for t in PLAN if t in allowed)
        args: dict[str, str] = {}
        f = self.inv.finding if self.inv else None
        if tool == "inspect_episode" and f:
            args = {"episode_id": f.marker_episode_id}
        elif tool == "ask_question" and self.requirement:
            args = {"requirement_id": self.requirement["requirement_id"]}
        elif tool == "request_reevaluation" and f:
            fact = self.requirement["about_fact_id"] if self.requirement else f.marker_episode_id
            args = {"fact_id": fact}
        return Choice(tool, args, None, "template")

    def choose(self, allowed: list[str]) -> Choice:
        if self.llm is None or self.llm_down:
            fallback = self.default(allowed)
            fallback.fallback_reason = self.llm_down or "no_key"
            return fallback
        rejected: list[str] = []
        reason: str | None = None
        for attempt in range(2):  # one call, one retry
            try:
                raw = self.llm.complete_json(SYSTEM, self.prompt(allowed, rejected))
                choice = self.validate(raw, allowed)
                choice.rejected = rejected
                self.transient_steps = 0
                return choice
            except LLMError as e:
                rejected.append(str(e))
                reason = e.reason
                if e.reason.startswith("http_") and not e.transient:
                    # 400/401/403/404: the key or model is wrong, so retrying won't help
                    self.llm_down = e.reason
                    break
                if e.transient and attempt == 0:
                    time.sleep(RETRY_DELAY_S)
            except Rejected as e:
                rejected.append(str(e))
                reason = e.code
        if reason in TRANSIENT:
            self.transient_steps += 1
            if self.transient_steps >= 2:  # still busy or out of quota: stop spending calls on this pass
                self.llm_down = reason
        fallback = self.default(allowed)
        fallback.rejected = rejected
        fallback.fallback_reason = reason
        return fallback

    def prompt(self, allowed: list[str], rejected: list[str]) -> str:
        body: dict[str, Any] = {
            "patient_id": self.pid,
            "finding_id": self.fid,
            "allowed_tools": {t: {"args": list(TOOL_ARGS[t]), "what": TOOL_HELP[t]} for t in allowed},
            "suggested": {"tool": (d := self.default(allowed)).tool, "args": d.args},
            "results": self.results,
        }
        if self.requirement and "ask_question" in allowed:
            body["ask_role"] = self.requirement["ask_role"]
        if rejected:
            body["your_last_reply_was_rejected_because"] = rejected[-1]
        return json.dumps(body, ensure_ascii=False)

    # ---------- checking the model's reply ----------

    def validate(self, raw: str, allowed: list[str]) -> Choice:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            raise Rejected("invalid_json", "the reply was not valid JSON") from None
        if not isinstance(data, dict):
            raise Rejected("invalid_json", "the reply was not a JSON object")
        tool = data.get("tool")
        if tool not in allowed:
            raise Rejected("invalid_tool", f"tool {tool!r} is not allowed now; pick one of {allowed}")
        args = data.get("args") or {}
        if not isinstance(args, dict) or set(args) != set(TOOL_ARGS[tool]):
            raise Rejected("invalid_json", f"{tool} takes exactly these args: {list(TOOL_ARGS[tool])}")
        for name, value in args.items():
            self.check_arg(tool, name, value)
        cited = data.get("cited_ids") or []
        if not isinstance(cited, list) or not all(isinstance(i, str) for i in cited):
            raise Rejected("invalid_json", "cited_ids must be a list of ID strings")
        invented = [i for i in cited if i not in self.seen.ids]
        if invented:
            raise Rejected("unknown_id", f"cites IDs that no tool returned: {', '.join(invented)}")
        text = data.get("text")
        if tool in TEXT_TOOLS:
            self.check_text(tool, text)
        else:
            text = None
        return Choice(tool, {k: str(v) for k, v in args.items()}, text, "llm")

    def check_arg(self, tool: str, name: str, value: Any) -> None:
        if not isinstance(value, str) or value not in self.seen.ids:
            raise Rejected("unknown_id", f"{name}={value!r} is not an ID from the results")
        f = self.inv.finding if self.inv else None
        ok = {
            "episode_id": f is not None and value in (f.index_episode_id, f.marker_episode_id),
            "requirement_id": self.requirement is not None and value == self.requirement["requirement_id"],
            "fact_id": value in self.fact_ids,
        }[name]
        if not ok:
            raise Rejected("unknown_id", f"{name}={value!r} is not valid for {tool}")

    def check_text(self, tool: str, text: Any) -> None:
        if not isinstance(text, str) or not text.strip():
            raise Rejected("invalid_json", f"{tool} needs text")
        if len(text) > MAX_TEXT:
            raise Rejected("invalid_json", f"text is longer than {MAX_TEXT} characters")
        ids = re.findall(rf"\b{re.escape(self.pid)}:[\w.-]+", text)
        if bad := [i for i in ids if i not in self.seen.ids]:
            raise Rejected("unknown_id", f"text names IDs that no tool returned: {', '.join(bad)}")
        prose = re.sub(rf"\b{re.escape(self.pid)}:[\w.-]+", " ", text)
        if m := MONTHS.search(prose):
            raise Rejected(
                "invented_fact", f"text uses a calendar date ({m.group(0)!r}); use the results' day numbers"
            )
        if bad := sorted({int(n) for n in NUMBER.findall(prose)} - self.seen.numbers):
            raise Rejected("invented_fact", f"text has numbers that are not in the results: {bad}")
        lower = prose.lower()
        drugs = {m.group(0).lower() for m in DRUG_STEM.finditer(prose)}
        drugs |= {w for w in re.findall(r"[a-z]+", lower) if w in DRUG_NAMES}
        if bad := sorted(d for d in drugs if d not in self.seen.corpus):
            raise Rejected("invented_fact", f"text names medicines that are not in the results: {bad}")
        if bad := [c for c, rx in CONDITION_RE if rx.search(prose) and c not in self.seen.corpus]:
            raise Rejected(
                "invented_fact", f"text names reasons or conditions that are not in the results: {bad}"
            )
        if m := CERTAINTY.search(prose):
            raise Rejected(
                "certainty_words",
                f"text states how certain a fact is ({m.group(0)!r}); leave certainty to the record",
            )
        if BANNED_COPY.search(prose):
            raise Rejected(
                "copy_rules", 'text breaks the copy rules; say "possible pattern" or "worth reviewing"'
            )
        if tool == "ask_question":
            if "?" not in prose:
                raise Rejected("invalid_json", "ask_question text must be a question")
            if SUGGESTS_ANSWER.search(prose):
                raise Rejected("invented_fact", "the question suggests its own answer")

    # ---------- running a tool ----------

    def call(self, c: Choice) -> None:
        args: dict[str, Any] = {"agent_tool": c.tool, **c.args, "phrasing": c.phrasing}
        if c.rejected:
            args["rejected"] = c.rejected
        if c.phrasing == "template" and c.fallback_reason:
            args["fallback_reason"] = c.fallback_reason
        try:
            ids, data = getattr(self, f"_{c.tool}")(c)
            ok = True
        except (NotFound, Invalid, Conflict) as e:
            ok, ids, data = False, [], None
            args["error"] = str(e) or type(e).__name__
            if isinstance(e, NotFound):
                args["outcome"] = "unknown ID"
        self.used.append(c.tool)
        self.phrasings.append(c.phrasing)
        if ok:
            if isinstance(data, dict) and data.get("text"):
                args["text"] = data["text"]
            if isinstance(data, dict):
                args["outcome"] = data.get("outcome", "answered with a path")
                if data.get("memory"):
                    args["memory"] = data["memory"]
            self.seen.absorb(data, ids)
            self.results.append({"tool": c.tool, "args": c.args, "ok": True, "returned": data})
        else:
            self.results.append({"tool": c.tool, "args": c.args, "ok": False, "error": args["error"]})
        self.record(c.tool, ok, args, ids)

    def record(self, tool: str, ok: bool, args: dict[str, Any], ids: list[str]) -> None:
        for _ in range(2):  # a human write between our read and this record moves the version: re-read once
            req = AgentStepRequest(
                step_id=f"{self.pid}:run-{self.run_n}-step-{len(self.steps) + 1}",
                case_version=self.store.findings(self.pid).case_version, finding_id=self.fid,
                tool=TOOL_MAP[tool], ok=ok, args=args, result_ids=list(dict.fromkeys(ids)),
            )
            try:
                self.steps.append(self.store.record_agent_step(req).step)
                return
            except Conflict:
                continue

    # ---------- the six tools ----------

    def _get_evidence_pack(self, c: Choice):
        inv = self.store.investigation(self.fid)
        self.inv = inv
        f = inv.finding
        refs = [*inv.documented, *inv.conflicts, *inv.unknowns]
        self.fact_ids = {
            f.index_episode_id, f.marker_episode_id, *f.observation_ids, *(r.fact_id for r in refs),
        }
        ref = lambda r: {  # noqa: E731
            "fact_id": r.fact_id, "field": r.field, "label": r.label, "value": r.value, "state": r.state,
            "day": r.happened_at, "source_ids": r.source_ids, "requirement_id": r.requirement_id,
        }
        data = {
            "finding": {
                "id": f.id, "status": f.status, "revision_n": f.revision_n, "headline": f.headline,
                "index_episode_id": f.index_episode_id, "marker_episode_id": f.marker_episode_id,
                "observation_ids": f.observation_ids,
            },
            "pattern": {"title": inv.pattern.title, "window_days": inv.pattern.window_days},
            "documented": [ref(r) for r in inv.documented],
            "conflicts": [ref(r) for r in inv.conflicts],
            "unknowns": [ref(r) for r in inv.unknowns],
            "sources": [{"id": s.id, "label": s.label, "day": s.happened_at} for s in inv.sources],
            "revisions": [{"id": r.id, "n": r.n, "status": r.status} for r in inv.revisions],
            "decisions": [
                {"id": d.id, "revision_n": d.revision_n, "by_role": d.by_role, "decision": d.decision}
                for d in inv.decisions
            ],
        }
        ids = [
            f.id, *dict.fromkeys(r.fact_id for r in refs), *(s.id for s in inv.sources),
            *(r.requirement_id for r in refs if r.requirement_id), *(r.id for r in inv.revisions),
            *(d.id for d in inv.decisions),
        ]
        return ids, data

    def _inspect_episode(self, c: Choice):
        eid = c.args["episode_id"]
        ep = next((e for e in self.store.timeline(self.pid).episodes if e.id == eid), None)
        if ep is None:
            raise NotFound(f"episode {eid}")
        data = {
            "id": ep.id, "medicine": ep.ingredient.name, "drug_class": ep.ingredient.drug_class,
            "start_day": ep.happened_at, "start_state": ep.state, "dose": ep.dose_text,
            "reason": ep.indication, "reason_state": ep.indication_state, "stop_day": ep.stop_day,
            "prescriber": ep.prescriber_specialty, "source_ids": ep.source_ids,
        }
        return [ep.id, *ep.source_ids], data

    def _next_missing_fact(self, c: Choice):
        inv = self.store.investigation(self.fid)
        q = inv.next_question
        if q is None:
            self.requirement = None
            note = "Nothing this pattern needs is missing."
            return [], {"next": None, "note": note, "outcome": "not in the graph"}
        about = next((r for r in inv.unknowns if r.requirement_id == q.requirement_id), None)
        self.requirement = {
            "requirement_id": q.requirement_id, "question_id": q.id, "ask_role": q.ask_role,
            "about_fact_id": about.fact_id if about else None, "field": about.field if about else None,
            "label": about.label if about else None, "template_text": q.text, "asked": q.asked_at is not None,
        }
        if about:
            self.fact_ids.add(about.fact_id)
        ids = [q.requirement_id, q.id, *([about.fact_id] if about else [])]
        if q.asked_at is None:
            return ids, {"next": self.requirement, "outcome": "answered with a path"}
        # Memory: the question was asked in an earlier pass. Say so, citing that pass's step, instead of
        # skipping ask_question silently.
        earlier = next(
            (s for s in self.store.agent_steps(self.pid).steps
             if s.ok and s.args.get("agent_tool", "ask_question" if s.tool == "draft_question_text" else None)
             == "ask_question" and q.id in s.result_ids),
            None,
        )
        run = m.group(1) if earlier and (m := re.search(r":run-(\d+)-step-", earlier.id)) else None
        where = f"run {run}" if run else "an earlier review"
        memory = (
            f"Asked in {where} (question {q.id}{f', step {earlier.id}' if earlier else ''}); "
            f"still waiting for the {q.ask_role}, not asking again."
        )
        self.memory = memory
        return [*ids, *([earlier.id] if earlier else [])], {
            "next": self.requirement, "outcome": "answered from memory", "memory": memory,
        }

    def _ask_question(self, c: Choice):
        res = self.store.ask_question(QuestionRequest(
            case_version=self.store.findings(self.pid).case_version,
            requirement_id=c.args["requirement_id"], text=c.text,
        ))
        self.question = res.question
        if self.requirement:
            self.requirement["asked"] = True
        q = res.question
        return [q.id, q.requirement_id], {
            "question_id": q.id, "ask_role": q.ask_role, "text": q.text, "asked_at": q.asked_at,
            "replayed": res.replayed,
        }

    def _request_reevaluation(self, c: Choice):
        res = self.store.affected(self.pid, c.args["fact_id"])  # read-only: nothing is written or re-run
        data = {
            "fact_id": res.fact_id,
            "depends_on_it": [
                {"id": f.id, "status": f.status, "revision_n": f.revision_n} for f in res.findings
            ],
            "note": "Read-only. Findings re-run only when a person confirms an evidence change.",
        }
        return [res.fact_id, *(f.id for f in res.findings)], data

    def _prepare_packet(self, c: Choice):
        packet = self.store.packet(self.pid)
        item = next((i for i in packet.items if i.finding.id == self.fid), None)
        if item is None:
            raise NotFound(f"finding {self.fid} is not in the packet")
        text = c.text or packet_template(item)
        self.packet_text = text
        refs = [*item.documented, *item.conflicts, *item.unknowns]
        ids = [*dict.fromkeys(r.fact_id for r in refs), *(q.id for q in item.open_questions)]
        return ids, {"text": text, "open_question_ids": [q.id for q in item.open_questions]}


def packet_template(item: PacketItem) -> str:
    """The deterministic next-conversation text. Only facts from the packet item; no new claims."""
    f = item.finding
    parts = [f"Worth reviewing: {item.pattern.title.lower()}. This is {STATUS_WORDS[f.status]}."]
    reasons = [r for r in item.documented if r.field == "indication" and r.value]
    if f.status == "competing_explanation" and reasons:
        parts.append(
            f"{reasons[0].label}: \"{reasons[0].value}\" ({reasons[0].state}), a competing explanation "
            "worth weighing."
        )
    if item.conflicts:
        parts.append("The records disagree on: " + "; ".join(r.label.lower() for r in item.conflicts) + ".")
    if item.unknowns:
        parts.append("Not known yet: " + "; ".join(r.label.lower() for r in item.unknowns) + ".")
    for q in item.open_questions:
        asked = "asked" if q.asked_at is not None else "to ask"
        parts.append(f"Open question for the {q.ask_role} ({asked}): {q.text}")
    if item.decisions:
        d = item.decisions[-1]
        parts.append(
            f"Revision {d.revision_n} has a {d.by_role} decision ({DECISION_WORDS[d.decision]}); "
            "it stays on that revision."
        )
    if f.status == "needs_reassessment":
        parts.append(
            f"The evidence changed after that review, so revision {f.revision_n} needs a fresh look."
        )
    parts.append("Any change to a medicine is the prescribing clinician's decision.")
    return " ".join(parts)


def run_review_agent(store, fid: str, llm: LLM | None, llm_off: str | None = None) -> ReviewAgentResult:
    """One agent pass for one finding. The caller has checked the finding exists and the version.
    `llm_off` runs the whole pass on templates and records it as every step's fallback_reason."""
    return ReviewPass(store, fid, llm, llm_off).run()


assert set(PLAN) == set(AGENT_TOOLS)
