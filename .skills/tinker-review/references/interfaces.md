<!--
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
-->

# Graph Review Skill — Module Interfaces

Module contracts for the Phase 1 vertical slice. Each module is independently
implementable against these signatures and data shapes.

Design reference: `~/graph-review.md`

---

## Data Types

```typescript
// === Extraction Output ===

interface ExtractionResult {
  language: string;
  files: FileInfo[];
  functions: FunctionInfo[];
  types: TypeInfo[];
  calls: CallInfo[];
  imports: ImportInfo[];
}

interface FileInfo {
  path: string;          // relative to worktree root
  language: string;      // e.g., "dart", "java", "go"
  changed: boolean;      // true if modified in this PR
}

interface FunctionInfo {
  name: string;
  signature: string;     // full signature as string
  visibility: "public" | "private" | "protected" | "internal";
  filePath: string;      // which file this lives in
  linesStart: number;
  linesEnd: number;
  changed: boolean;      // true if modified in this PR
}

interface TypeInfo {
  name: string;
  kind: "class" | "interface" | "struct" | "enum";
  visibility: "public" | "private" | "protected" | "internal";
  filePath: string;
}

interface CallInfo {
  callerName: string;    // function making the call
  callerFile: string;
  calleeName: string;    // function being called
  line: number;          // line of the call site
}

interface ImportInfo {
  filePath: string;      // file containing the import
  importedPath: string;  // what is being imported
  importedName: string;  // specific symbol if applicable, or "*"
}

// === Infrastructure ===

interface ServerHandle {
  port: number;
  containerId: string;
  url: string;           // ws://localhost:${port}/gremlin
}

// === Graph Population ===

interface PopulationSummary {
  vertices: number;
  edges: number;
  breakdown: {
    files: number;
    functions: number;
    types: number;
    calls: number;
    defines: number;
    dependsOn: number;
  };
}

// === Pattern Results ===

interface CompletenessResult {
  node: string;          // vertex id or identifier checked
  present: string[];     // edge labels that exist
  missing: string[];     // edge labels that are absent
  score: number;         // present.length / (present.length + missing.length)
}

interface CoverageGapResult {
  uncovered: {
    name: string;
    signature: string;
    filePath: string;
    linesStart: number;
    linesEnd: number;
  }[];
  totalChanged: number;
  totalCovered: number;
}

// === Evidence Package (renderer input) ===

interface EvidencePackage {
  meta: {
    pr: number;
    title: string;
    domain: string;       // e.g., "glv", "driver-server", "glv, driver-server"
    language: string;     // dominant language detected
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
    timestamp: string;
  };
  graphStats: PopulationSummary;
  checks: {
    completeness: CompletenessResult[];
    coverageGaps: CoverageGapResult;
    centrality: CentralityResult;
    blastRadius: BlastRadiusResult;
    clusters: ClusterResult;
  };
  discussions: DiscoveryResult;
  guidedWalk: GuidedWalkSection[];
}

// === Narrative Input (agent-provided content for render()) ===
//
// All fields are plain data — no HTML markup.
// render() converts them to deterministic HTML.

interface NarrativeInput {
  // 2–4 paragraph strings. Lead with what the PR does, not "This review...".
  // Mention cluster coherence, highest-blast functions, any JIRA context.
  summary?: string[];

  // One entry per key changed file, ordered by impact (hotspots first).
  // 'what' is prose: be concrete about what changed and why it matters.
  // Set attention:true for high-centrality or high-blast files.
  guidedWalk?: Array<{
    filePath: string;
    what: string;
    attention?: boolean;
    functions?: string[];  // names of key functions touched
  }>;

  // Summary of functional test plan and results.
  functionalTest?: {
    layers: string[];           // e.g. ["embedded"] or ["embedded", "python-glv"]
    reasoning: string;          // why those layers were chosen
    results: Array<{
      scenario: string;
      result: "pass" | "fail" | "skip";
      note?: string;
    }>;
    observations?: string;      // adversarial findings / key takeaways
  };

  // One entry per concrete issue found.
  // 'snippet' is verbatim code (plain text, not escaped).
  findings?: Array<{
    title: string;
    filePath?: string;
    snippet?: string;
    concern: string;
    fix?: string;
    structuralContext?: string; // graph-derived context (callers, blast radius, etc.)
  }>;

  // One question per entry.
  openQuestions?: string[];

  // Full test execution details for the appendix.
  appendixFunctional?: {
    environment?: Record<string, string>;  // java, build, serverConfig, connectionUrl, dataset, …
    tests: Array<{
      name: string;
      language: string;   // "groovy" | "python" | "javascript" | "go" | "csharp"
      script: string;     // full script text
      output: string;     // complete stdout/stderr
    }>;
  };
}

interface GuidedWalkSection {
  filePath: string;
  narrative: string;
  functions: Array<{
    name: string;
    signature: string;
    linesStart: number;
    linesEnd: number;
    isHotspot: boolean;
    blastRadius: number;
  }>;
  snippet: string;          // up to 1500 chars of source
  prLink: string;           // GitHub diff anchor URL
  attention: boolean;       // true if contains hotspot functions
  maxBlast: number;
}

interface CentralityResult {
  hotspots: Array<{
    name: string;
    filePath: string;
    signature: string;
    linesStart: number;
    linesEnd: number;
    changed: boolean;
    inDegree: number;
    outDegree: number;
    totalDegree: number;
    inherentlyCentral: boolean;
  }>;
  totalAnalyzed: number;
  aboveThreshold: number;
  filteredAsBoilerplate: number;
}

interface BlastRadiusResult {
  functions: Array<{
    name: string;
    filePath: string;
    signature: string;
    linesStart: number;
    linesEnd: number;
    changed: boolean;
    reachableCount: number;
    depth: number;
  }>;
  maxReachable: number;
  totalWithCallers: number;
  depth: number;
}

interface ClusterResult {
  clusterCount: number;
  coherent: boolean;         // true if clusterCount <= 1
  clusters: Array<{ id: number; files: string[]; size: number }>;
  totalFiles: number;
}

interface DiscoveryResult {
  jiras: JiraEntry[];
  jiraMissing: boolean;
  devList: DevListEntry[];
  devListMissing: boolean;
  devListSearchPerformed: boolean;
  devListSearchKeywords: string[];
  secondary: Array<JiraEntry | DevListEntry>;
  prComments: { issue: PrComment[]; review: PrComment[] };
  proposals: ProposalEntry[];
  proposalLinked: boolean;
  proposalMissing: boolean;
}
```

---

## Module Signatures

### extraction/tree-sitter.js

```javascript
/**
 * Parse source files in a directory using Tree-sitter.
 * Returns structured extraction data for graph population.
 *
 * @param {string} directory - Absolute path to the PR worktree
 * @param {string} language - Primary language to parse (e.g., "dart")
 * @param {object} options
 * @param {string[]} [options.changedFiles] - List of files changed in PR (relative paths)
 * @returns {Promise<ExtractionResult>}
 */
export async function extract(directory, language, options = {}) {}
```

**Responsibilities:**
- Load the appropriate tree-sitter grammar for the language
- Walk the directory, parse each source file
- Run queries to extract functions, types, call sites, imports
- Mark `changed: true` on files/functions that appear in `options.changedFiles`
- Return the structured `ExtractionResult`

**Does NOT:**
- Connect to Gremlin Server
- Create graph vertices/edges
- Understand Gremlin step semantics

---

### infrastructure/docker.js

```javascript
/**
 * Start a Gremlin Server Docker container with TinkerGraph.
 * Uses a random available port. Polls until server is ready.
 *
 * @param {object} options
 * @param {string} [options.image] - Docker image (default: "tinkerpop/gremlin-server:4.0.1")
 * @param {number} [options.timeoutMs] - Max wait for readiness (default: 30000)
 * @returns {Promise<ServerHandle>}
 */
export async function startServer(options = {}) {}

/**
 * Stop and remove the Gremlin Server container.
 *
 * @param {ServerHandle} handle - Handle returned by startServer
 * @returns {Promise<void>}
 */
export async function stopServer(handle) {}
```

**Responsibilities:**
- Find a random unused port
- Run `docker run` with correct config (empty graph, GraphBinary)
- Poll the HTTP endpoint until ready
- Return connection details
- Clean up container on stop

**Does NOT:**
- Manage the gremlin-js client connection (that's the caller's job)
- Know anything about the graph schema

---

### graph/populate.js

```javascript
/**
 * Populate TinkerGraph with extraction data.
 * Creates vertices and edges matching the PR knowledge graph schema.
 *
 * @param {object} g - gremlin-js GraphTraversalSource (already connected)
 * @param {ExtractionResult} extraction - Output from tree-sitter module
 * @returns {Promise<PopulationSummary>}
 */
export async function populate(g, extraction) {}
```

**Schema mapping:**

| Extraction data | Graph vertex | Key properties |
|---|---|---|
| `files[]` | `File` | path, language, changed |
| `functions[]` | `Function` | name, signature, visibility, lines_start, lines_end, changed |
| `types[]` | `Type` | name, kind, visibility |

| Extraction data | Graph edge | From → To |
|---|---|---|
| `calls[]` | `calls` | Function → Function (matched by name+file) |
| `functions[].filePath` | `defines` | File → Function |
| `types[].filePath` | `defines` | File → Type |
| `imports[]` | `depends_on` | File → File |

**Responsibilities:**
- Create all vertices with properties
- Create all edges (matching by name for call targets)
- Handle cases where call targets don't resolve (function in external dependency) — skip edge, don't fail
- Return population summary with counts

**Does NOT:**
- Create semantic edges (implements_step, tests, covers) — that's agent enrichment
- Parse source files — that's the extraction module's job

---

### patterns/completeness.js

```javascript
/**
 * Check that a vertex has all expected outgoing/incoming edge labels.
 *
 * @param {object} g - gremlin-js GraphTraversalSource
 * @param {object} params
 * @param {string} params.vertexLabel - Label of vertex to check (e.g., "Step")
 * @param {string} [params.vertexName] - Name property to filter by
 * @param {string[]} params.expectedEdges - Edge labels that should exist
 *   Prefix with "in:" or "out:" for direction (default: "out:")
 *   e.g., ["out:has_rule", "in:implements_step", "in:covers", "in:documents"]
 * @returns {Promise<CompletenessResult[]>}
 */
export async function completeness(g, params) {}
```

---

### patterns/coverage-gaps.js

```javascript
/**
 * Find changed functions that have no incoming 'tests' edge.
 *
 * @param {object} g - gremlin-js GraphTraversalSource
 * @param {object} params
 * @param {boolean} [params.changedOnly] - Only check functions with changed=true (default: true)
 * @returns {Promise<CoverageGapResult>}
 */
export async function coverageGaps(g, params = {}) {}
```

---

### renderer/render.js

```javascript
/**
 * Render an evidence package to a self-contained HTML page.
 *
 * @param {EvidencePackage} evidence - Structured evidence from review.js
 * @param {NarrativeInput} [narrative] - Agent-provided content (see NarrativeInput type)
 * @returns {string} - Complete HTML document as a string
 */
export function render(evidence, narrative = {}) {}
```

**Responsibilities:**
- Produce a single self-contained HTML string (embedded CSS, no external deps)
- Auto-render all structural sections from evidence: context/discussions (with JIRA
  comments), cluster SVG visualization, coverage gaps, centrality hotspots, blast
  radius, completeness, graph stats, and file-by-file walk data
- Render all `NarrativeInput` fields from structured data into deterministic HTML —
  the agent never writes markup
- Show empty-state placeholders for any omitted narrative fields

**Does NOT:**
- Fetch data or run queries
- Generate the narrative content (that's the agent's job)
- Accept raw HTML in the narrative object

---

### review.js (orchestrator)

```javascript
/**
 * Execute a graph-based review of a PR.
 * Runs the deterministic phases and outputs a JSON evidence file.
 * The agent then reads that JSON, writes narrative sections, and calls render().
 *
 * @param {object} params
 * @param {number} params.pr - PR number
 * @param {string} params.repoPath - Path to the git repository
 * @param {object} [params.options]
 * @param {string} [params.options.outputPath] - Where to write the JSON (default: ./pr-review-${pr}.json)
 * @param {string} [params.options.remote] - Git remote name (default: "upstream")
 * @returns {Promise<string>} - Path to the generated JSON file
 */
export async function review(params) {}
```

**Orchestration steps:**
1. `git fetch ${remote} pull/${pr}/head:pr-review/${pr}`
2. `git worktree add /tmp/pr-review-${pr} pr-review/${pr}`
3. Determine changed files via `git diff --name-only ${base}...pr-review/${pr}`
4. Classify domain (may be multiple: e.g., "glv, driver-server")
5. `startServer()` — binds both `g` (standard) and `a` (OLAP/withComputer)
6. `extract(worktreePath, language, { changedFiles })`
7. `populate(g, extraction)` + `createPrDiscussion(g, ...)`
8. `discoverDiscussions(...)` — JIRA, PR comments, dev list, proposals
9. `completeness()`, `coverageGaps()`, `highCentrality()`, `blastRadius()`, `clusterAnalysis()`
10. `buildGuidedWalk(...)` — file-by-file sections sorted by attention/blast
11. Assemble `EvidencePackage` → write JSON
12. `stopServer(handle)` + cleanup worktree + branch

**The agent then:**
1. Runs enrichment (Phase 2) — reads graph, writes semantic edges
2. Spawns functional test subagent — runs embedded/GLV tests, collects results
3. Reads the JSON output and source code in the worktree
4. Assembles a `NarrativeInput` object (structured data, no HTML)
5. Calls `render(evidence, narrative)` → writes HTML to `/tmp/pr-review-<pr>.html`

---

## Dependency Graph

```
INTERFACES.md (this file — defines contracts)
       │
       ├──→ extraction/tree-sitter.js     ──┐
       ├──→ infrastructure/docker.js      ──┤
       ├──→ discovery/discussions.js      ──┤
       ├──→ enrichment/api.js (read+write)──┤
       ├──→ renderer/render.js              │
       │                                    ▼
       │                       graph/populate.js
       │                                    │
       │                                    ▼
       │            patterns/completeness.js
       │            patterns/coverage-gaps.js
       │            patterns/centrality.js
       │            patterns/blast-radius.js
       │            patterns/cluster-analysis.js
       │            patterns/orphans.js
       │                                    │
       └──→ review.js (orchestrator) ◄──────┘
```

Modules at the top can be implemented in parallel.
`review.js` depends on all modules above it.
