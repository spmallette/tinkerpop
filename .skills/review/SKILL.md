---
name: review
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
- `upstream` remote pointing to `git@github.com:apache/tinkerpop.git` (fetch only)
- Node.js 20+ with dependencies installed in `.skills/review/`


## References (load on demand)

- Read [references/schema.md](references/schema.md) when you need to understand what vertices, edges, or properties exist in the knowledge graph (typically during enrichment or when writing raw Gremlin)
- Read [references/interfaces.md](references/interfaces.md) when you need the exact function signatures or data type definitions for a module

## Execution Sequence

When invoked with `/review <pr-number>`:

### 1. Setup

```javascript
import { startServer, stopServer } from "./scripts/infrastructure/docker.js";
import { extract } from "./scripts/extraction/tree-sitter.js";
import { populate } from "./scripts/graph/populate.js";
import { completeness } from "./scripts/patterns/completeness.js";
import { coverageGaps } from "./scripts/patterns/coverage-gaps.js";
import { render } from "./scripts/renderer/render.js";
import {
  listFunctions, listTypes, getCallsFrom, getCanonicalSteps,
  mapStep, linkDiscussion, annotate
} from "./scripts/enrichment/api.js";
```

Fetch the PR and create a worktree:
```bash
git fetch upstream pull/<pr>/head:pr-review/<pr>
git worktree add /tmp/pr-review-<pr> pr-review/<pr>
```

Determine changed files:
```bash
BASE=$(git merge-base pr-review/<pr> upstream/master)
git diff --name-only $BASE...pr-review/<pr>
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

### 6. Synthesize and Render

The `review.js` script outputs a JSON file (`pr-review-<pr>.json`) containing all
structural evidence: graph stats, completeness results, coverage gaps, centrality
hotspots, blast radius data, and code snippets per file.

**Your job as the agent:** Read the JSON, read the playbook's **Interpret** section,
read the actual source code in the worktree, and produce the HTML report.

The report structure:

**Main narrative (what the reviewer reads):**
- **Summary** — one paragraph: what this PR does and why. No verdict or recommendation —
  that's the reviewer's job.
- **Guided Walk** — the narrative tour. Lead the reviewer through the PR in priority
  order. For each key area: explain what it does, why it matters, what the reviewer
  should focus on, and what they can safely skip. Use the centrality/blast data to
  justify attention routing — don't just sort by numbers, explain the implications.
- **Findings** — concrete code review suggestions with code snippets. You have the
  source code and the graph context (centrality, callers, coverage). Use them to
  identify specific improvements: bugs, edge cases, inconsistencies, naming issues,
  missing error handling, etc. For each finding:
  - Show the relevant code snippet
  - Explain the concern
  - Suggest a fix (with code) when possible
  - Note structural context (e.g., "this function has 604 callers — behavioral
    change here has wide impact")
- **Open Questions** — things you couldn't verify, escape conditions triggered,
  areas where you lack context to make a judgment

Do NOT include a "Verdict" or "Recommendation" section. The report provides
evidence and suggestions — the human decides what to do with them.

**Supporting data (appendix for drill-down):**
- Structural Hotspots table (from centrality data)
- Coverage Gaps table
- Completeness results
- Graph Statistics

Write the final HTML to `./pr-review-<pr>.html`.

### 7. Cleanup

```javascript
await stopServer(handle);
```

```bash
git worktree remove /tmp/pr-review-<pr>
git branch -D pr-review/<pr>
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
[review] Done. Guidebook: ./pr-review-<n>.html
```

## Important Notes

- NEVER push to the `upstream` remote. It is fetch-only.
- The graph exists only for the duration of the review (Docker container is ephemeral).
- If the Gremlin Server container fails to start, check Docker is running.
- If tree-sitter fails for a language, report it — may need additional WASM grammar.
