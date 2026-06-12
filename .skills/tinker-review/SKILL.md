---
name: tinker-review
description: >
  Graph-based PR review for Apache TinkerPop. Builds a knowledge graph from
  PR source code, enriches it with semantic relationships guided by domain
  playbooks, runs structural analysis, and produces an HTML evidence package.
  Use when asked to review a TinkerPop PR by number.
license: Apache-2.0
compatibility: Requires Docker, Node.js 20+, git. Network access for fetching PR refs.
metadata:
  version: "0.1.0"
  project: Apache TinkerPop
---

# Graph Review Skill

## Prerequisites

- Docker running (for Gremlin Server)
- Node.js 20+ with dependencies installed in `.skills/review/`

## References

- Read [references/schema.md](references/schema.md) when you need to understand what vertices, edges, or properties exist in the knowledge graph (typically during enrichment or when writing raw Gremlin)
- Read [references/interfaces.md](references/interfaces.md) when you need the exact function signatures or data type definitions for a module

## Execution Sequence

When invoked with `/review <pr-number>`:

### 1. Setup

Run the deterministic analysis pipeline. `review.js` handles fetching the PR ref,
creating the worktree, and running all checks — do NOT do these steps manually first:

```bash
cd .skills/tinker-review
node scripts/review.js <pr> <repo-path>
# e.g.: node scripts/review.js 3448 /home/user/tinkerpop
```

This produces `/tmp/pr-review-<pr>.json` and leaves the worktree at `/tmp/pr-review-<pr>/`
for you to read source files during enrichment. The imports below are available during
enrichment (Phase 2) — you call them directly, not through review.js:

```javascript
import { render } from "./scripts/renderer/render.js";
import {
  listFunctions, listTypes, getCallsFrom, getCanonicalSteps,
  mapStep, linkDiscussion, linkDoc, addGrammarRule, annotate
} from "./scripts/enrichment/api.js";
```

### 2. Phase 1 — Extract and Populate (deterministic)

Start the graph server, extract structure, populate the graph:

```javascript
const handle = await startServer();
// connect gremlin-js to handle.url
const extraction = await extract(worktreePath, language, { changedFiles });
const graphStats = await populate(g, extraction);

// Always create the PR Discussion vertex (enables completeness checks on linked issues)
await createPrDiscussion(g, pr, prTitle, prBody);
```

### 3. Classify and Load Playbooks

**Always load** `playbooks/general.md` — it applies to every PR.

Then determine which domain-specific playbooks apply from changed file paths (may be multiple):
- Files in `gremlin-dart/`, `gremlin-go/`, `gremlin-python/`, `gremlin-dotnet/`, `gremlin-js/` → `playbooks/glv.md`
- Files in `gremlin-core/` with new step patterns → `playbooks/new-step.md`
- Files in `gremlin-driver/`, `gremlin-server/`, `gremlin-util/` → `playbooks/driver-server.md`
- Small change set with linked issue, fixing behavior → `playbooks/bug-fix.md`
- Files in `gremlin-language/` or `*.g4` → `playbooks/grammar.md`

Load ALL matching playbooks. A new step PR might match both `new-step.md` and
`glv.md` if it includes GLV implementations. Read each playbook's **Enrich**
section — you will execute them in sequence (general first, then domain-specific).

### 4. Phase 2 — Enrichment (agent-driven)

This is where YOU (the agent) apply judgment. For each loaded playbook, read its
Enrich section and follow its guidance. Execute playbooks in sequence — the graph
is additive, each playbook's enrichment builds on what prior playbooks added.

You have these tools:

**Read the graph:**
- `listFunctions(g, { changed: true, visibility: "public" })` — see what's in the graph
- `listTypes(g, { kind: "class" })` — see types
- `getCallsFrom(g, functionName, filePath)` — trace calls
- `getCanonicalSteps(repoPath)` — get all Gremlin step names from the grammar

**Read source files:** You have direct filesystem access to the worktree at `/tmp/pr-review-<pr>/`.

**Write to the graph:**
- `mapStep(g, functionName, filePath, canonicalStepName)` — map a function to a Gremlin step
- `linkDiscussion(g, url, source, title, body?)` — link a JIRA/proposal/devlist discussion
- `linkDoc(g, entityLabel, entityName, docPath, section?)` — link documentation to a step/function/type
- `addGrammarRule(g, name, production?)` — create a GrammarRule vertex
- `annotate(g, label, name, key, value)` — add a property to a vertex

**Your job during enrichment:**
1. Read the playbook Enrich section
2. Use the read API and source files to understand the PR
3. Use the write API to add semantic edges
4. Stop when the Enrich section's guidance is satisfied

**Check the playbook's Escape conditions.** If you hit one, stop enrichment and
note it as a gap in the evidence package.

### 5. Phase 3 — Analysis (deterministic)

Run the Checks from ALL loaded playbooks against the enriched graph:

```javascript
const completenessResults = await completeness(g, { ... });
const coverageResult = await coverageGaps(g, { changedOnly: true });
```

Each playbook's Checks section specifies what to run. Collect all results.

### 6. Functional Testing (subagent)

Build the PR and run functional tests from a user's perspective.

**Setup:**

```bash
# Git won't check out the same branch in two worktrees. Create a local branch
# pointing to the same commit, then add a worktree for that branch.
git branch pr-build/<pr> pr-review/<pr>
git worktree add /tmp/pr-build-<pr> pr-build/<pr>
cd /tmp/pr-build-<pr>
mvn clean install -DskipTests
```

Start Gremlin Server from the built artifacts on a random port (different from
the knowledge graph server):

```bash
# Find a free port
PORT=<random unused port>
# Start from the built assembly
cd gremlin-server/target/apache-tinkerpop-gremlin-server-*-standalone
bin/gremlin-server.sh conf/gremlin-server-min.yaml &
```

**Determine context for the subagent:**

Based on the PR's domain and changed files, select:
- Relevant documentation (e.g., `docs/src/reference/the-traversal.asciidoc` sections
  about the affected step/feature)
- Relevant test features (e.g., `gremlin-test/src/main/resources/.../Tree.feature`)
- The PR title and description

Do NOT give the subagent:
- Source code of the implementation
- The knowledge graph or Phase 1 JSON
- The code review findings
- Access to the analysis worktree

**Spawn the subagent:**

The subagent receives:
- Its role: "You are testing this feature as a user. You only know what the
  documentation says and what the test scenarios demonstrate. Do not read
  implementation source code."
- The PR title/description (what the change claims to do)
- The specific doc content (extracted sections, not the whole file)
- The specific test feature content (Gherkin scenarios showing expected behavior)
- The Gremlin Server connection URL and port
- The path to the built assembly (for accessing GLV clients)
- Instructions below

**Test layer decision:**

The subagent decides which test layers to execute and states its reasoning:

Layer 1 (embedded) — when the PR changes traversal behavior, step logic,
or core data structures. Tests correctness without network complexity.
Execute via Gremlin Console with embedded TinkerGraph from the built assembly.

Layer 2 (per-GLV over the wire) — when the change affects what crosses the wire.
Connect from each relevant GLV client to the running Gremlin Server and test.
  - All GLVs: if serialization formats, data types, or response structure changed
  - Specific GLV only: if the PR is a GLV-specific change, or the bug was reported
    through that GLV
  - Skip: if the change is purely computational (same types in, same types out,
    just different values — the wire format is unchanged)

State your reasoning in the test plan. Not all layers need to execute for every PR.

GLV clients are available in the build worktree:
- Python: `gremlin-python/target/` (install via pip from built wheel)
- JavaScript: `gremlin-javascript/` (npm link from built package)
- Go: `gremlin-go/` (use built module directly)
- .NET: `gremlin-dotnet/` (dotnet run from built project)

**The subagent returns:**
- Test plan (what layers it chose, which GLVs, and why)
- Results (pass/fail for each test, with actual output)
- Adversarial findings (edge cases it tried to break)
- The exact test code it executed (scripts per language)

**After the subagent completes:**
- Stop the functional test Gremlin Server
- Remove the build worktree
- Include the subagent's results in the report:
  - **In the main Functional Test section:** test plan summary, pass/fail grid,
    key observations. Link to the appendix for details.
  - **In the appendix (Functional Test Details):** full execution environment
    description (build command, server config, connection URL, dataset used),
    the actual test code that was executed (full Groovy scripts), and complete
    output for each test so the reviewer can verify the results independently.

### 7. Synthesize and Render

The `review.js` script outputs a JSON file (`pr-review-<pr>.json`) containing all
structural evidence: graph stats, completeness results, coverage gaps, centrality
hotspots, blast radius data, cluster analysis, discussions, and code snippets per file.

**Your job as the agent:** Read the JSON, read the playbook's **Interpret** section,
read the actual source code in the worktree, and produce the HTML report.

Assemble a `NarrativeInput` object — **structured data, not HTML** — then call
`render()` via stdin. `render()` converts it to deterministic HTML so every report
looks identical in structure regardless of which agent wrote it.

See [references/interfaces.md](references/interfaces.md) for the full `NarrativeInput`
type definition and field-by-field guidance.

```bash
node --input-type=module << 'EOF'
import { readFileSync, writeFileSync } from "node:fs";
import { render } from "<repoPath>/.skills/tinker-review/scripts/renderer/render.js";
const evidence = JSON.parse(readFileSync("/tmp/pr-review-<pr>.json", "utf-8"));
const html = render(evidence, {
  summary: ["What this PR does...", "What the graph reveals..."],
  guidedWalk: [{ filePath: "...", what: "...", attention: true, functions: ["fn"] }],
  functionalTest: { layers: ["embedded"], reasoning: "...", results: [{ scenario: "...", result: "pass" }] },
  findings: [{ title: "...", filePath: "...", snippet: "...", concern: "...", fix: "..." }],
  openQuestions: ["..."],
  appendixFunctional: { environment: { java: "11" }, tests: [{ name: "...", language: "groovy", script: "...", output: "..." }] },
});
writeFileSync("/tmp/pr-review-<pr>.html", html);
EOF
```

`render()` auto-renders all structural sections (context/discussions, cluster SVG,
appendix with coverage gaps, centrality, blast radius, graph stats, file-by-file walk).

Do NOT include a "Verdict" or "Recommendation" section — the human decides.

Write the final HTML to `/tmp/pr-review-<pr>.html`.

### 8. Cleanup

```javascript
await stopServer(handle);  // knowledge graph server
```

```bash
git worktree remove /tmp/pr-review-<pr>
git worktree remove /tmp/pr-build-<pr>
git branch -D pr-review/<pr>
git branch -D pr-build/<pr>
```

## Progress Output

Emit `[review]` lines between phases so the user sees progress:

```
[review] PR #<n> — fetching...
[review] PR #<n> — classified as: <domain> (<language>, <n> files changed)
[review] Starting Gremlin Server on port <port>...
[review] Phase 1: Extracting structure...
[review] Phase 1 complete: <n> vertices, <n> edges
[review] Phase 2: Enriching (playbook: <domain>)...
[review] Phase 2 complete: added <n> semantic edges
[review] Phase 3: Running checks...
[review] Phase 4: Building PR for functional testing...
[review] Build complete. Starting test server on port <port>...
[review] Spawning functional test subagent...
[review] Functional testing complete: <n> passed, <n> failed, <n> adversarial
[review] Synthesizing report...
[review] Done. Report: /tmp/pr-review-<n>.html
```

## Important Notes

- NEVER push to the `upstream` remote. It is fetch-only.
- The graph exists only for the duration of the review (Docker container is ephemeral).
- If the Gremlin Server container fails to start, check Docker is running.
- If tree-sitter fails for a language, report it — may need additional WASM grammar.
