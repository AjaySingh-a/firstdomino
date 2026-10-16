"""The review agent with a fake LLM (no network): good replies, invented IDs and text rejected, the one
retry, the template fallback, the read-only re-evaluation tool and POST /findings/{id}/review-agent."""

import io
import json
import urllib.error

import pytest
from fastapi.testclient import TestClient

from agent import llm as llm_mod
from agent import review_agent
from agent.llm import LLMError, OpenAICompatLLM, llm_from_env
from agent.review_agent import ReviewPass, run_review_agent
from agent.tools import AGENT_TOOLS, ALLOWLIST, TOOL_MAP
from api.main import app, store
from api.store import BANNED_COPY, default_store

P1 = "syn-p1:fnd-ccb-edema-loop-1"
P3 = "syn-p3:fnd-ccb-edema-loop-1"

GOOD_TEXT = {
    "ask_question": "Do you know why furosemide was started around day 35? A letter or a note would help.",
    "prepare_packet": (
        "Possible pattern worth reviewing: amlodipine from day 0, ankle swelling from day 21, then "
        "furosemide from day 35. Why furosemide was started is the open question for the caregiver."
    ),
}


class FakeLLM:
    """Plays the model. `policy(prompt, call_n)` returns the reply text; every prompt is kept."""

    model = "fake"

    def __init__(self, policy):
        self.policy = policy
        self.prompts: list[dict] = []

    def complete_json(self, system: str, user: str) -> str:
        prompt = json.loads(user)
        self.prompts.append(prompt)
        return self.policy(prompt, len(self.prompts))


def good(prompt: dict, _n: int = 0) -> str:
    """A well-behaved model: takes the suggested tool and args, writes grounded text."""
    s = prompt["suggested"]
    text = GOOD_TEXT.get(s["tool"])
    cited = list(s["args"].values())
    return json.dumps({"tool": s["tool"], "args": s["args"], "text": text, "cited_ids": cited})


@pytest.fixture
def fresh():
    return default_store()


@pytest.fixture(autouse=True)
def no_retry_wait(monkeypatch):
    monkeypatch.setattr(review_agent, "RETRY_DELAY_S", 0)


def tools_of(result):
    return [s.args["agent_tool"] for s in result.steps]


# ---------- the allowlist ----------


def test_six_tools_map_onto_the_contract_names():
    assert AGENT_TOOLS == (
        "inspect_episode", "get_evidence_pack", "next_missing_fact", "ask_question", "request_reevaluation",
        "prepare_packet",
    )
    assert set(TOOL_MAP.values()) <= set(ALLOWLIST)


# ---------- a good model ----------


def test_good_replies_are_used(fresh):
    fake = FakeLLM(good)
    r = run_review_agent(fresh, P1, fake)
    assert r.phrasing == "llm"
    assert tools_of(r) == [
        "get_evidence_pack", "inspect_episode", "next_missing_fact", "ask_question", "request_reevaluation",
        "prepare_packet",
    ]
    assert all(s.ok and s.args["phrasing"] == "llm" and "rejected" not in s.args for s in r.steps)
    assert r.question.text == GOOD_TEXT["ask_question"] and r.question.asked_at == 60
    assert r.packet_text == GOOD_TEXT["prepare_packet"]
    assert len(fake.prompts) == 6  # one call per step
    assert fresh.agent_steps("syn-p1").steps[-6:] == r.steps  # every call persisted


# ---------- rejected replies, the retry, the fallback ----------


def test_invented_ids_are_rejected_then_the_retry_is_used(fresh):
    def policy(prompt, n):
        if n == 1:  # first reply cites an ID no tool returned
            return json.dumps({"tool": "get_evidence_pack", "args": {}, "text": None,
                               "cited_ids": ["syn-p1:ep-warfarin"]})
        return good(prompt)

    r = run_review_agent(fresh, P1, FakeLLM(policy))
    first = r.steps[0]
    assert first.args["phrasing"] == "llm"
    assert "syn-p1:ep-warfarin" in first.args["rejected"][0]
    assert all("ep-warfarin" not in i for s in r.steps for i in s.result_ids)


def test_invented_arg_id_is_rejected(fresh):
    def policy(prompt, n):
        if prompt["suggested"]["tool"] == "inspect_episode":
            return json.dumps({"tool": "inspect_episode", "args": {"episode_id": "syn-p1:ep-made-up"},
                               "text": None, "cited_ids": []})
        return good(prompt)

    r = run_review_agent(fresh, P1, FakeLLM(policy))
    step = next(s for s in r.steps if s.args["agent_tool"] == "inspect_episode")
    assert step.args["phrasing"] == "template" and len(step.args["rejected"]) == 2  # call + one retry
    assert step.args["fallback_reason"] == "unknown_id"
    assert step.args["episode_id"] == "syn-p1:ep-furosemide"  # the plan's choice


@pytest.mark.parametrize("bad_text, reason, code", [
    ("Was furosemide started on day 12?", "numbers", "invented_fact"),
    ("Was furosemide started on 3 March?", "calendar", "invented_fact"),
    ("Do you know why warfarin was started around day 35?", "medicines", "invented_fact"),
    ("Do you know why furosemide, likely for heart failure, was started?", "conditions", "invented_fact"),
    ("Furosemide was started for the ankle swelling, right?", "suggests its own answer", "invented_fact"),
    ("Is furosemide " + "sa" + "fe to keep around day 35?", "copy rules", "copy_rules"),
    ("Tell me about furosemide.", "must be a question", "invalid_json"),
    ("Was syn-p1:ep-made-up started on day 35?", "IDs that no tool returned", "unknown_id"),
    ("Is the reason furosemide was started still unknown on day 35?", "certain", "certainty_words"),
])
def test_invented_text_falls_back_to_the_template(fresh, bad_text, reason, code):
    def policy(prompt, n):
        if prompt["suggested"]["tool"] == "ask_question":
            return json.dumps({"tool": "ask_question", "args": prompt["suggested"]["args"], "text": bad_text,
                               "cited_ids": []})
        return good(prompt)

    r = run_review_agent(fresh, P1, FakeLLM(policy))
    step = next(s for s in r.steps if s.args["agent_tool"] == "ask_question")
    assert step.args["phrasing"] == "template"
    assert len(step.args["rejected"]) == 2 and reason in step.args["rejected"][0]
    assert step.args["fallback_reason"] == code
    assert r.question.text.startswith("Do you know why the water tablet (furosemide)")  # the template
    assert r.phrasing == "mixed"


def test_may_and_march_as_verbs_are_not_dates(fresh):
    text = ("Possible pattern worth reviewing: furosemide from day 35 may need a closer look. "
            "Why furosemide was started is the open question.")

    def policy(prompt, n):
        if prompt["suggested"]["tool"] == "prepare_packet":
            return json.dumps({"tool": "prepare_packet", "args": {}, "text": text, "cited_ids": []})
        return good(prompt)

    r = run_review_agent(fresh, P1, FakeLLM(policy))
    assert r.packet_text == text and r.steps[-1].args["phrasing"] == "llm"
    assert review_agent.MONTHS.search("seen on May 3") and review_agent.MONTHS.search("the 3rd of March")


def test_the_model_never_states_how_certain_a_fact_is(fresh):
    """The real case: story 1's swelling onset is only reported by the caregiver (day 21). A model that
    calls it documented is rejected, and the packet falls back to the template, which takes each
    fact's state from the record."""
    assert next(o for o in fresh.timeline("syn-p1").observations).state == "reported"
    wrong = ("Possible pattern worth reviewing: amlodipine from day 0; the swelling onset is documented "
             "on day 21; furosemide from day 35.")

    def policy(prompt, n):
        if prompt["suggested"]["tool"] == "prepare_packet":
            return json.dumps({"tool": "prepare_packet", "args": {}, "text": wrong, "cited_ids": []})
        return good(prompt)

    r = run_review_agent(fresh, P1, FakeLLM(policy))
    step = r.steps[-1].args
    assert step["agent_tool"] == "prepare_packet" and step["phrasing"] == "template"
    assert step["fallback_reason"] == "certainty_words" and "'documented'" in step["rejected"][0]
    assert "documented" not in r.packet_text


@pytest.mark.parametrize("word", [
    "documented", "Documentation", "confirmed", "unconfirmed", "reported", "reports", "verified",
    "proven", "proved", "established", "known", "unknown", "well-known",
])
def test_every_form_of_a_certainty_word_is_caught(word):
    assert review_agent.CERTAINTY.search(f"the onset is {word} here")


def test_asking_whether_someone_knows_is_not_a_certainty_claim():
    assert not review_agent.CERTAINTY.search("Do you know why furosemide was started around day 35?")


def test_not_json_and_disallowed_tools_are_rejected(fresh):
    replies = iter(["not json", json.dumps({"tool": "create_finding", "args": {}, "text": None})])
    r = ReviewPass(fresh, P1, FakeLLM(lambda p, n: next(replies, good(p))))
    result = r.run()
    first = result.steps[0].args
    assert first["phrasing"] == "template"
    assert "not valid JSON" in first["rejected"][0] and "not allowed" in first["rejected"][1]
    assert first["fallback_reason"] == "invalid_tool"  # the reason of the last attempt


class Failing:
    """An endpoint that fails with `code` `times` times (forever if times is None), then answers like
    `then`. Counts calls."""

    model = "failing"

    def __init__(self, code, times=None, then=None):
        self.code, self.times, self.then, self.calls = code, times, then, 0

    def complete_json(self, system, user):
        self.calls += 1
        if self.times is None or self.calls <= self.times:
            raise LLMError(self.code, f"answered {self.code}")
        return self.then(json.loads(user))


@pytest.mark.parametrize("code", ["http_401", "http_403", "http_404"])
def test_a_config_error_switches_to_templates_for_the_rest_of_the_pass(fresh, code):
    llm = Failing(code)
    r = run_review_agent(fresh, P1, llm)
    assert llm.calls == 1  # no retry against a wrong key or model, and no call for later steps
    assert r.phrasing == "template" and len(r.steps) == 6
    assert [s.args["fallback_reason"] for s in r.steps] == [code] * 6


@pytest.mark.parametrize("code", ["http_429", "http_503", "timeout"])
def test_a_busy_model_is_retried_then_given_up_on_after_two_steps(fresh, code):
    llm = Failing(code)
    r = run_review_agent(fresh, P1, llm)
    assert llm.calls == 4  # two steps x (call + one retry); then no more calls this pass
    assert len(r.steps) == 6 and all(s.ok for s in r.steps)
    assert [s.args["fallback_reason"] for s in r.steps] == [code] * 6
    assert r.steps[0].args["rejected"] == [f"answered {code}"] * 2


def test_a_transient_error_does_not_cost_the_rest_of_the_pass(fresh):
    llm = Failing("http_503", times=1, then=good)  # one 503, then a working model
    r = run_review_agent(fresh, P1, llm)
    assert r.phrasing == "llm"  # the retry answered, and later steps still use the model
    assert r.steps[0].args["rejected"] == ["answered http_503"]
    assert all("fallback_reason" not in s.args for s in r.steps)


def test_no_key_runs_end_to_end_on_templates(fresh, monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    assert llm_from_env() is None
    r = run_review_agent(fresh, P1, llm_from_env())
    assert r.phrasing == "template" and all(s.ok for s in r.steps)
    assert {s.args["fallback_reason"] for s in r.steps} == {"no_key"}
    assert r.question.id == "syn-p1:q-furosemide-indication"
    assert "Any change to a medicine is the prescribing clinician's decision." in r.packet_text
    assert not BANNED_COPY.search(r.packet_text)


# ---------- what the agent cannot do ----------


def test_the_agent_writes_no_evidence_findings_or_decisions(fresh):
    before_t = fresh.timeline("syn-p3").model_dump()
    before_f = fresh.findings("syn-p3")
    r = run_review_agent(fresh, P3, FakeLLM(good))
    assert "ask_question" not in tools_of(r)  # nothing is missing on story 3
    assert fresh.timeline("syn-p3").model_dump() == before_t
    assert fresh.findings("syn-p3") == before_f  # same findings, same case_version
    reeval = next(s for s in r.steps if s.args["agent_tool"] == "request_reevaluation")
    assert reeval.result_ids == ["syn-p3:ep-furosemide", P3]


def test_a_second_pass_does_not_ask_again(fresh):
    run_review_agent(fresh, P1, None)
    again = run_review_agent(fresh, P1, None)
    assert again.question is None and "ask_question" not in tools_of(again)
    assert again.steps[0].id == "syn-p1:run-2-step-1"


# ---------- the key never leaks ----------


def test_key_is_not_in_repr_or_errors(monkeypatch):
    secret = "sk-test-do-not-print"
    monkeypatch.setenv("LLM_API_KEY", secret)
    client = llm_from_env()
    assert secret not in repr(client)

    def boom(req, timeout):
        assert req.get_header("Authorization") == f"Bearer {secret}"
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, io.BytesIO(b"{}"))

    monkeypatch.setattr(llm_mod.urllib.request, "urlopen", boom)
    with pytest.raises(LLMError) as e:
        client.complete_json("s", "u")
    assert secret not in str(e.value) and e.value.__cause__ is None


def test_openai_compatible_request_shape(monkeypatch):
    seen = {}

    class Res(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout):
        seen["url"], seen["body"] = req.full_url, json.loads(req.data)
        seen["agent"] = req.get_header("User-agent")
        return Res(json.dumps({"choices": [{"message": {"content": '{"tool": "x"}'}}]}).encode())

    monkeypatch.setattr(llm_mod.urllib.request, "urlopen", fake_urlopen)
    out = OpenAICompatLLM("https://example.test/v1/", "k", "m").complete_json("sys", "usr")
    assert out == '{"tool": "x"}'
    assert seen["url"] == "https://example.test/v1/chat/completions"
    assert seen["body"]["model"] == "m" and seen["body"]["response_format"] == {"type": "json_object"}
    assert seen["agent"] == "firstdomino-agent/0.1"  # Cloudflare blocks urllib's default (403/1010)


# ---------- HTTP ----------


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    store.reset()
    with TestClient(app) as c:
        yield c


def test_review_agent_route(client):
    r = client.post(f"/findings/{P1}/review-agent", json={"case_version": 2})
    assert r.status_code == 200
    body = r.json()
    assert body["phrasing"] == "template" and body["case_version"] == 3  # asking a question moves it
    assert [s["args"]["agent_tool"] for s in body["steps"]][-1] == "prepare_packet"
    assert body["question"]["asked_at"] == 60
    steps = client.get("/patients/syn-p1/agent-steps").json()["steps"]
    assert [s["id"] for s in steps][-6:] == [s["id"] for s in body["steps"]]

    assert client.post(f"/findings/{P1}/review-agent", json={"case_version": 2}).status_code == 409
    assert client.post("/findings/syn-p1:fnd-x/review-agent", json={"case_version": 3}).status_code == 404


def test_affected_route_is_read_only(client):
    before = client.get("/patients/syn-p3/findings").json()
    r = client.get("/patients/syn-p3/facts/syn-p3:obs-ankle-swelling/affected").json()
    assert [f["id"] for f in r["findings"]] == [P3] and r["findings"][0]["status"] == "reviewed"
    unrelated = client.get("/patients/syn-p3/facts/syn-p3:ep-atorvastatin/affected").json()
    assert unrelated["findings"] == []
    assert client.get("/patients/syn-p3/findings").json() == before
    assert client.get("/patients/syn-p3/facts/syn-p3:nope/affected").status_code == 404


def test_the_fallback_model_answers_when_the_main_one_is_busy(monkeypatch):
    asked = []

    class Res(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout):
        model = json.loads(req.data)["model"]
        asked.append(model)
        if model == "busy-model":
            raise urllib.error.HTTPError(req.full_url, 503, "Unavailable", {}, io.BytesIO(b"{}"))
        return Res(json.dumps({"choices": [{"message": {"content": "{}"}}]}).encode())

    monkeypatch.setattr(llm_mod.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setenv("LLM_API_KEY", "k")
    monkeypatch.setenv("FD_AGENT_MODEL", "busy-model")
    monkeypatch.setenv("FD_AGENT_FALLBACK_MODEL", "spare-model")
    client = llm_from_env()
    assert client.complete_json("s", "u") == "{}"
    assert client.complete_json("s", "u") == "{}"
    assert asked == ["busy-model", "spare-model", "spare-model"]  # the spare stays in use for the pass
    assert client.model == "spare-model"


def test_http_errors_carry_a_reason_code(monkeypatch):
    def boom(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, io.BytesIO(b"{}"))

    monkeypatch.setattr(llm_mod.urllib.request, "urlopen", boom)
    with pytest.raises(LLMError) as e:
        OpenAICompatLLM("https://example.test/v1", "k", "no-such-model").complete_json("s", "u")
    assert e.value.reason == "http_404" and not e.value.transient


def test_groq_json_validate_failed_is_a_bad_reply_not_a_bad_key(monkeypatch, fresh):
    body = json.dumps({"error": {"code": "json_validate_failed", "message": "Failed to generate JSON."}})

    def boom(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {}, io.BytesIO(body.encode()))

    monkeypatch.setattr(llm_mod.urllib.request, "urlopen", boom)
    with pytest.raises(LLMError) as e:
        OpenAICompatLLM("https://example.test/v1", "k", "m").complete_json("s", "u")
    assert e.value.reason == "invalid_json"

    llm = Failing("invalid_json", times=1, then=good)  # one invalid-JSON 400, then a good reply
    r = run_review_agent(fresh, P1, llm)
    assert r.phrasing == "llm" and r.steps[0].args["rejected"] == ["answered invalid_json"]
