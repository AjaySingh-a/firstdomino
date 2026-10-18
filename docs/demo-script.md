# Demo video script (3:00)

Recording of **https://firstdomino-web.vercel.app**. It follows the guided tour, then the patient lab,
the MCP clip and the packet. One voiceover line per scene; read it slowly, it is timed for that.

All patient data is synthetic. Say "possible pattern", never "caused".

## Before you record

- [ ] **Reset the demo.** Open any story, scroll to the sandbox, press **Reset all stories** (or
      `curl -X POST https://api-production-b29f.up.railway.app/sandbox/reset`). This also deletes lab patients.
- [ ] `https://api-production-b29f.up.railway.app/health` shows `"status":"ok","falkordb":"up","appendonly":"yes"`.
- [ ] **Wait 60 s between review-agent runs** (Groq free-tier rate limit). Do one practice run at least
      a minute before recording, so the recorded run is phrased by the model (the panel says "Text phrased
      by the model"), not by the templates.
- [ ] Fresh browser profile or a private window, so the first-visit tour card shows.
- [ ] Screen **1920×1080**, browser zoom **125%**, bookmarks bar hidden, notifications off.
- [ ] Claude Desktop restarted once, so it has loaded the `firstdomino` MCP server (see the end of this page).
- [ ] A quiet room for the voiceover. Record the screen first, then the voice over it if that is easier.

## Scenes

| Time | Screen and exact clicks | Voiceover |
|---|---|---|
| **0:00-0:15** · The problem | Landing page. Let the chain animation play once. Mouse rests on the headline. | "An older patient starts amlodipine. Weeks later their ankles swell. Another doctor treats the swelling with a water tablet. Each step looks reasonable. Together, they can be a prescribing cascade." |
| **0:15-0:35** · Story 1, the pattern | Click **Start the tour** on the welcome card. Step 1: press **Next**. Step 2: let the three beats play, press **Next**. | "FirstDomino lines up one synthetic patient's medicines and symptoms across visits. Amlodipine on day 0, swelling on day 21, furosemide on day 35." |
| **0:35-0:50** · The evidence path | Step 3: click the **amber arc**. Step 4: let the drawer open, point at **Not known yet**, press **Next**. | "The amber arc is a possible pattern from a cited study, not a verdict. The drawer separates what is on record, what the caregiver reported, and the one thing nobody wrote down: why furosemide was started." |
| **0:50-1:10** · The next question and scoped re-evaluation | Step 5: click **ankle swelling**, press **Record answer**. Step 6: hold on the **What changed** card, point at **Findings re-checked 1**. Press **Next**. | "The caregiver answers. Only the finding that depends on that fact is re-checked, and the change is kept as version 2. Nothing else in the graph moves." |
| **1:10-1:30** · The review agent and the query trace | Step 7: press **Run review agent**, wait for **Done**. Press **Next**. Step 8: open **How the graph found this**. Press **Next**. | "A bounded review agent reads the evidence, looks for what is missing and drafts the conversation for the clinician. It cannot create a finding or change a fact. Every view is a named Cypher query on FalkorDB, starting from the patient." |
| **1:30-1:50** · Story 3, the correction | Step 9: press **Confirm correction**. Hold on **Needs a fresh look** and the decision kept on **version 1**. Press **Next**. Step 10: press **Apply this change** (atorvastatin). Hold on "nothing changed". | "Story 3: a clinician already reviewed this. A late GP note moves the swelling to day 14. The finding needs a fresh look, and the clinician's decision stays on the version they saw. Change atorvastatin, which no pattern uses, and nothing reopens." |
| **1:50-2:25** · The patient lab: FalkorDB decides live | Header: **Patient lab**. Click **Wrong order**, then **Write to the graph and walk it**. Let the timed steps and the walk draw. Scroll to **The same list, read without the graph**. Then click **A lookalike medicine**, **Write to the graph and walk it**, show **No chain in the graph** and the flat list's **Flag**. | "Don't take our three stories on trust. Build a patient, and it is written to FalkorDB and walked in milliseconds, by the same rules. Put furosemide first and the graph says it doesn't fit. A flat medicine list flags it anyway. Swap in diltiazem: same family name, different drug class. The class edge sees that. A name match can't. Without the graph, the lab has no answer at all." |
| **2:25-2:45** · MCP in Claude Desktop (20 s clip) | Cut to the Claude Desktop clip (below). | "The same graph is available to AI assistants through an MCP server. Claude asks FirstDomino for the next question and which findings depend on it, using read-only tools." |
| **2:45-2:55** · The packet | Back in the browser: open **/packet/syn-p1** (Review packet link in the story header). Scroll once. | "For the clinician, a one-page packet: what is on record, what is open, and the citations. The prescribing clinician decides." |
| **2:55-3:00** · Close | Landing page, URL bar visible. | "FirstDomino. Agents that act on connected data, with memory that keeps every version. Try it at firstdomino-web.vercel.app." |

Tracks to show on the last frame (as text or a slide): **Agents That Act on Connected Data** ·
**Agent Memory and Coordination**.

## The 20-second MCP clip

Claude Desktop already has this entry in
`~/Library/Application Support/Claude/claude_desktop_config.json` (a backup of the earlier file is next
to it, `claude_desktop_config.json.bak-firstdomino`):

```json
"firstdomino": {
  "command": "/Users/devgrover/.local/bin/uv",
  "args": ["run", "--directory", "/Users/devgrover/FirstDomino", "python", "-m", "mcp_server"]
}
```

1. Quit Claude Desktop fully (Cmd+Q) and open it again. Check that **firstdomino** shows under the tools
   (connectors) menu with 6 tools.
2. Start recording, then paste:
   > Using FirstDomino, review story 1 and tell me the next question a pharmacist should ask, and which
   > findings depend on that fact.
3. Approve the tool calls when asked (`next_missing_fact`, `which_findings_depend_on`). Stop the
   recording when the answer finishes (about 20 s). Speed it up in editing if it runs longer.

The tools call the live API, so reset the demo first. If story 1's question was already answered in the
tour, the answer will say no question is open; reset again before this clip.
