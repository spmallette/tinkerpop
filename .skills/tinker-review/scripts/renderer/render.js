/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(__dirname, "template.html"), "utf-8");

const CLUSTER_COLORS = ["#4dabf7", "#51cf66", "#fcc419", "#ff6b6b", "#cc5de8", "#20c997", "#f06595", "#74c0fc"];

const DOMAIN_PLAYBOOKS = {
  glv: "glv",
  grammar: "grammar",
  "driver-server": "driver-server",
  "bug-fix": "bug-fix",
  "new-step": "new-step",
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreClass(score) {
  if (score >= 0.8) return "bar-fill-good";
  if (score >= 0.5) return "bar-fill-warn";
  return "bar-fill-bad";
}

function shortPath(filePath, depth = 2) {
  return filePath.split("/").slice(-depth).join("/");
}

// ─── Narrative renderers (structured data → HTML) ────────────────────────────
//
// Each function accepts typed data from the narrative object and produces
// deterministic HTML. The agent never writes markup.

/**
 * summary: string[]  — array of paragraph strings
 */
function renderNarrativeSummary(summary) {
  if (!summary || summary.length === 0) {
    return '<p class="empty-state">Summary not yet written.</p>';
  }
  const paragraphs = Array.isArray(summary) ? summary : [summary];
  return paragraphs
    .map((p) => `<p style="margin-bottom:0.75rem;line-height:1.7">${escapeHtml(p)}</p>`)
    .join("\n");
}

/**
 * guidedWalk: Array<{
 *   filePath: string,
 *   what: string,          — prose description of what changed and why it matters
 *   attention?: boolean,   — flag for high-risk files
 *   functions?: string[]   — names of key functions touched
 * }>
 */
function renderNarrativeGuidedWalk(sections) {
  if (!sections || sections.length === 0) {
    return '<div class="empty-state">Guided walk not yet written.</div>';
  }
  return sections
    .map((s, i) => {
      const attentionBadge = s.attention
        ? '<span class="badge badge-attention">Attention</span>'
        : "";
      const fnLine =
        s.functions && s.functions.length > 0
          ? `<p style="margin-top:0.5rem;font-size:0.8rem;color:var(--text-muted)">Key functions: ${s.functions.map((f) => `<code>${escapeHtml(f)}</code>`).join(", ")}</p>`
          : "";
      return `<div class="walk-section${s.attention ? " walk-attention" : ""}">
  <div class="walk-header">
    <span class="walk-number">${i + 1}</span>
    <span class="walk-file">${escapeHtml(shortPath(s.filePath, 3))}</span>
    ${attentionBadge}
  </div>
  <p style="font-size:0.9rem;line-height:1.65">${escapeHtml(s.what)}</p>
  ${fnLine}
</div>`;
    })
    .join("\n");
}

/**
 * functionalTest: {
 *   layers: string[],        — e.g. ["embedded", "python-glv"]
 *   reasoning: string,       — why those layers were chosen
 *   results: Array<{
 *     scenario: string,
 *     result: "pass" | "fail" | "skip",
 *     note?: string
 *   }>,
 *   observations?: string    — adversarial findings / key takeaways
 * }
 */
function renderNarrativeFunctionalTest(ft) {
  if (!ft) {
    return '<div class="empty-state">Functional testing not yet performed.</div>';
  }

  const layers =
    ft.layers && ft.layers.length > 0
      ? `<p style="margin-bottom:0.4rem"><strong>Test layers:</strong> ${ft.layers.map((l) => `<code>${escapeHtml(l)}</code>`).join(", ")}</p>`
      : "";

  const reasoning = ft.reasoning
    ? `<p style="margin-bottom:0.75rem;font-size:0.875rem;color:var(--text-muted)">${escapeHtml(ft.reasoning)}</p>`
    : "";

  let grid = "";
  if (ft.results && ft.results.length > 0) {
    const rows = ft.results
      .map((r) => {
        const cls =
          r.result === "pass" ? "test-pass" : r.result === "fail" ? "test-fail" : "test-skip";
        const sym = r.result === "pass" ? "✓" : r.result === "fail" ? "✗" : "○";
        return `<span class="${cls}">${sym}</span><span>${escapeHtml(r.scenario)}</span><span style="color:var(--text-muted);font-size:0.8rem">${escapeHtml(r.note || "")}</span>`;
      })
      .join("\n");
    grid = `<div class="test-grid" style="margin-bottom:0.75rem">${rows}</div>`;
  }

  const observations = ft.observations
    ? `<p style="font-size:0.875rem">${escapeHtml(ft.observations)}</p>`
    : "";

  const appendixLink = `<p style="margin-top:0.75rem;font-size:0.8rem"><a href="#appendix-functional">Full test scripts and output →</a></p>`;

  return `<div class="card">${layers}${reasoning}${grid}${observations}${appendixLink}</div>`;
}

/**
 * findings: Array<{
 *   title: string,
 *   filePath?: string,
 *   snippet?: string,          — verbatim code excerpt (not escaped — will be escaped here)
 *   concern: string,           — what the problem is
 *   fix?: string,              — suggested remediation
 *   structuralContext?: string — graph-derived context (callers, blast radius, etc.)
 * }>
 */
function renderNarrativeFindings(findings) {
  if (!findings || findings.length === 0) {
    return '<div class="empty-state">No findings recorded.</div>';
  }
  return findings
    .map((f, i) => {
      const location = f.filePath
        ? ` <span style="font-size:0.78rem;color:var(--text-muted)"><code>${escapeHtml(shortPath(f.filePath))}</code></span>`
        : "";
      const snippet = f.snippet
        ? `<pre><code>${escapeHtml(f.snippet)}</code></pre>`
        : "";
      const fix = f.fix
        ? `<p style="margin-top:0.5rem"><strong>Suggestion:</strong> ${escapeHtml(f.fix)}</p>`
        : "";
      const ctx = f.structuralContext
        ? `<p style="margin-top:0.4rem;font-size:0.78rem;color:var(--text-muted)">Graph context: ${escapeHtml(f.structuralContext)}</p>`
        : "";
      return `<div class="card" style="border-left:3px solid var(--warning)">
  <h3 style="margin-bottom:0.35rem">${i + 1}. ${escapeHtml(f.title)}${location}</h3>
  ${snippet}<p style="font-size:0.9rem;line-height:1.6">${escapeHtml(f.concern)}</p>${fix}${ctx}
</div>`;
    })
    .join("\n");
}

/**
 * openQuestions: string[]  — each entry is one question
 */
function renderNarrativeOpenQuestions(questions) {
  if (!questions || questions.length === 0) {
    return '<div class="empty-state">No open questions recorded.</div>';
  }
  const items = questions
    .map(
      (q) =>
        `<li style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.9rem;line-height:1.6">${escapeHtml(q)}</li>`
    )
    .join("\n");
  return `<ol style="list-style:none;counter-reset:q">${items}</ol>`;
}

/**
 * appendixFunctional: {
 *   environment?: Record<string, string>,  — key/value pairs (java, serverConfig, connectionUrl, dataset, …)
 *   tests: Array<{
 *     name: string,
 *     language: string,   — "groovy" | "python" | "javascript" | "go" | "csharp"
 *     script: string,     — full script text
 *     output: string      — complete stdout/stderr
 *   }>
 * }
 */
function renderNarrativeAppendixFunctional(appendix) {
  if (!appendix) {
    return '<div class="empty-state">No functional test details available.</div>';
  }

  const parts = [];

  if (appendix.environment && Object.keys(appendix.environment).length > 0) {
    const rows = Object.entries(appendix.environment)
      .map(
        ([k, v]) =>
          `<tr><td style="font-weight:500;white-space:nowrap;padding-right:1rem">${escapeHtml(k)}</td><td><code>${escapeHtml(String(v))}</code></td></tr>`
      )
      .join("\n");
    parts.push(
      `<h3>Environment</h3><div class="card"><table class="gap-table"><tbody>${rows}</tbody></table></div>`
    );
  }

  if (appendix.tests && appendix.tests.length > 0) {
    const testCards = appendix.tests
      .map(
        (t) => `<div class="card" style="margin-bottom:1rem">
  <h3 style="margin-bottom:0.25rem">${escapeHtml(t.name)}</h3>
  <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem">Language: <code>${escapeHtml(t.language)}</code></p>
  <details>
    <summary style="cursor:pointer;font-size:0.8rem;color:var(--primary);margin-bottom:0.4rem">Script</summary>
    <pre><code>${escapeHtml(t.script)}</code></pre>
  </details>
  <details>
    <summary style="cursor:pointer;font-size:0.8rem;color:var(--primary);margin-bottom:0.4rem">Output</summary>
    <pre><code>${escapeHtml(t.output)}</code></pre>
  </details>
</div>`
      )
      .join("\n");
    parts.push(`<h3>Test Execution</h3>${testCards}`);
  }

  return parts.length > 0
    ? parts.join("\n")
    : '<div class="empty-state">No functional test details available.</div>';
}

// ─── Structural renderers (evidence data → HTML) ──────────────────────────────

function renderPlaybookBadges(domain) {
  const playbooks = ["general"];
  const d = (domain || "").toLowerCase();
  for (const [key, name] of Object.entries(DOMAIN_PLAYBOOKS)) {
    if (d.includes(key)) playbooks.push(name);
  }
  return playbooks
    .map((p) => `<span class="badge badge-playbook">${escapeHtml(p)}</span>`)
    .join(" ");
}

function renderClusterSvg(clusters) {
  if (!clusters || clusters.length === 0) return "";

  const R = 13;
  const NODE_W = R * 2 + 8;
  const ROW_H = R * 2 + 28;
  const LABEL_W = 80;
  const PAD = 12;
  const MAX_PER_ROW = 14;

  const maxPerRow = Math.min(MAX_PER_ROW, Math.max(...clusters.map((c) => c.files.length)));
  const svgW = Math.max(360, LABEL_W + PAD + maxPerRow * NODE_W + PAD);
  const svgH = PAD + clusters.length * ROW_H + PAD;

  let nodes = "";
  clusters.forEach((cluster, ci) => {
    const color = CLUSTER_COLORS[ci % CLUSTER_COLORS.length];
    const midY = PAD + ci * ROW_H + R;

    nodes += `<text x="${LABEL_W - 8}" y="${midY + 5}" text-anchor="end" font-size="11" fill="#6c757d" font-family="sans-serif">C${cluster.id} (${cluster.size})</text>`;

    cluster.files.slice(0, MAX_PER_ROW).forEach((file, fi) => {
      const cx = LABEL_W + PAD + fi * NODE_W + R;
      const name = file.split("/").pop().replace(/\.[^.]+$/, "").slice(0, 9);
      nodes += `<circle cx="${cx}" cy="${midY}" r="${R}" fill="${color}" fill-opacity="0.75"/>`;
      nodes += `<text x="${cx}" y="${midY + R + 9}" text-anchor="middle" font-size="7" fill="#495057" font-family="monospace">${escapeHtml(name)}</text>`;
    });

    if (cluster.files.length > MAX_PER_ROW) {
      const cx = LABEL_W + PAD + MAX_PER_ROW * NODE_W + R;
      nodes += `<text x="${cx}" y="${midY + 5}" font-size="10" fill="#6c757d" font-family="sans-serif">+${cluster.files.length - MAX_PER_ROW}</text>`;
    }
  });

  return `<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto;display:block;margin:0.75rem 0;">${nodes}</svg>`;
}

function renderClusters(result) {
  if (!result) {
    return '<div class="empty-state">Cluster analysis not available.</div>';
  }

  const coherentBadge = result.coherent
    ? '<span class="badge badge-coherent">Coherent</span>'
    : '<span class="badge badge-fragmented">Fragmented</span>';

  const statusText = result.coherent
    ? "All changed files form a single connected component."
    : `${result.clusterCount} disconnected clusters — this PR may bundle unrelated changes.`;

  const svg = renderClusterSvg(result.clusters || []);

  const clusterList = (result.clusters || [])
    .map((c) => {
      const files = c.files.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join("");
      return `<div style="margin-bottom:0.75rem">
  <strong style="font-size:0.875rem">Cluster ${c.id}</strong>
  <span style="font-size:0.8rem;color:var(--text-muted)">(${c.size} file${c.size !== 1 ? "s" : ""})</span>
  <ul style="list-style:none;margin-top:0.2rem;font-size:0.78rem;color:var(--text-muted)">${files}</ul>
</div>`;
    })
    .join("");

  return `<div class="card">
  <p style="margin-bottom:0.6rem">${coherentBadge} ${escapeHtml(statusText)}</p>
  ${svg}
  <div style="margin-top:0.5rem">${clusterList}</div>
</div>`;
}

function renderDiscussions(discussions) {
  if (!discussions) {
    return '<div class="empty-state">No discussion data available.</div>';
  }

  const parts = [];

  if (discussions.jiras && discussions.jiras.length > 0) {
    const items = discussions.jiras
      .map((j) => {
        const comments =
          j.comments && j.comments.length > 0
            ? `<ul style="margin-top:0.35rem;list-style:none;font-size:0.78rem;color:var(--text-muted)">${j.comments.slice(0, 3).map((c) => `<li style="padding:0.2rem 0;border-top:1px solid var(--border)"><em>${escapeHtml(c.author)}:</em> ${escapeHtml(c.body.slice(0, 200))}${c.body.length > 200 ? "…" : ""}</li>`).join("")}</ul>`
            : "";
        return `<div style="padding:0.5rem 0;border-bottom:1px solid var(--border)">
    <a href="${escapeHtml(j.url)}" target="_blank"><strong>${escapeHtml(j.id)}</strong></a>
    — ${escapeHtml(j.title)}
    <span style="font-size:0.75rem;color:var(--text-muted);margin-left:0.35rem">[${escapeHtml(j.status || "open")}]</span>
    ${comments}
  </div>`;
      })
      .join("");
    parts.push(`<div class="card"><h3>JIRA</h3>${items}</div>`);
  } else if (discussions.jiraMissing) {
    parts.push(
      `<div class="card"><h3>JIRA</h3><p style="font-size:0.875rem;color:var(--text-muted)">No TINKERPOP-XXXX reference found in PR title or description.</p></div>`
    );
  }

  const prComments = [
    ...(discussions.prComments?.issue || []),
    ...(discussions.prComments?.review || []),
  ];

  if (prComments.length > 0) {
    const items = prComments
      .slice(0, 6)
      .map(
        (c) => `<div style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.875rem">
    <strong>${escapeHtml(c.author)}</strong>${c.url ? ` <a href="${escapeHtml(c.url)}" target="_blank" style="font-size:0.75rem">↗</a>` : ""}
    <p style="margin-top:0.2rem;color:var(--text-muted)">${escapeHtml(c.body.slice(0, 260))}${c.body.length > 260 ? "…" : ""}</p>
  </div>`
      )
      .join("");
    const more =
      prComments.length > 6
        ? `<p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.4rem">${prComments.length - 6} more comment(s) not shown.</p>`
        : "";
    parts.push(
      `<div class="card"><h3>PR Comments (${prComments.length})</h3>${items}${more}</div>`
    );
  }

  if (discussions.devList && discussions.devList.length > 0) {
    const items = discussions.devList
      .map(
        (d) => `<div style="padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.875rem">
    <a href="${escapeHtml(d.url)}" target="_blank">${escapeHtml(d.title)}</a>
    ${d.date ? `<span style="font-size:0.75rem;color:var(--text-muted);margin-left:0.35rem">${escapeHtml(d.date)}</span>` : ""}
  </div>`
      )
      .join("");
    const label = discussions.devListSearchPerformed ? "Dev List (searched)" : "Dev List";
    parts.push(`<div class="card"><h3>${label}</h3>${items}</div>`);
  }

  if (discussions.proposals && discussions.proposals.length > 0) {
    const items = discussions.proposals
      .map(
        (p) => `<div style="padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.875rem">
    <code>${escapeHtml(p.path)}</code> — ${escapeHtml(p.title)}
    <span style="font-size:0.75rem;color:var(--text-muted);margin-left:0.35rem">[matched: ${p.matchedKeywords.join(", ")}]</span>
  </div>`
      )
      .join("");
    parts.push(`<div class="card"><h3>Proposals</h3>${items}</div>`);
  }

  return parts.length > 0
    ? parts.join("\n")
    : '<div class="empty-state">No linked discussions found.</div>';
}

function renderGuidedWalk(sections, pr) {
  if (!sections || sections.length === 0) {
    return '<div class="empty-state">No guided walk sections generated.</div>';
  }

  return sections
    .map((section, i) => {
      const badge = section.attention
        ? '<span class="badge badge-attention">Attention</span>'
        : "";
      const blastBadge =
        section.maxBlast > 5
          ? `<span class="badge badge-blast">Blast: ${section.maxBlast}</span>`
          : "";
      const fnList = section.functions
        .map((f) => {
          const hotspot = f.isHotspot
            ? '<span style="color:var(--danger);margin-right:0.2rem">●</span>'
            : "";
          const blast =
            f.blastRadius > 0
              ? `<span class="blast-count">(${f.blastRadius} callers)</span>`
              : "";
          return `<li>${hotspot}<code>${escapeHtml(f.name)}</code>${blast} <span class="lines">L${f.linesStart}–${f.linesEnd}</span></li>`;
        })
        .join("\n");
      const snippetHtml = section.snippet
        ? `<details class="snippet-details"><summary>View code snippet</summary><pre><code>${escapeHtml(section.snippet)}</code></pre></details>`
        : "";
      return `<div class="walk-section${section.attention ? " walk-attention" : ""}">
  <div class="walk-header">
    <span class="walk-number">${i + 1}</span>
    <span class="walk-file">${escapeHtml(shortPath(section.filePath, 3))}</span>
    ${badge}${blastBadge}
  </div>
  <p class="walk-narrative">${escapeHtml(section.narrative)}</p>
  <ul class="walk-functions">${fnList}</ul>
  ${snippetHtml}
  <a class="pr-link" href="${section.prLink}" target="_blank">View diff in PR →</a>
</div>`;
    })
    .join("\n");
}

function renderCentrality(result) {
  if (!result || result.hotspots.length === 0) {
    return '<div class="empty-state">No high-centrality functions found among changed code.</div>';
  }
  const rows = result.hotspots
    .map(
      (h) => `<tr>
  <td class="fn-name">${escapeHtml(h.name)}</td>
  <td class="file-path">${escapeHtml(shortPath(h.filePath))}</td>
  <td class="num">${h.inDegree}</td>
  <td class="num">${h.outDegree}</td>
  <td class="num"><strong>${h.totalDegree}</strong></td>
</tr>`
    )
    .join("\n");
  return `<div class="card">
  <p style="margin-bottom:0.75rem;font-size:0.85rem;color:var(--text-muted)">${result.aboveThreshold} of ${result.totalAnalyzed} analyzed functions exceed centrality threshold</p>
  <table class="gap-table">
    <thead><tr><th>Function</th><th>File</th><th>In</th><th>Out</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

function renderBlastRadius(result) {
  if (!result || result.functions.length === 0) {
    return '<div class="empty-state">No downstream callers found for changed functions.</div>';
  }
  const rows = result.functions
    .slice(0, 12)
    .map(
      (f) => `<tr>
  <td class="fn-name">${escapeHtml(f.name)}</td>
  <td class="file-path">${escapeHtml(shortPath(f.filePath))}</td>
  <td class="num"><strong>${f.reachableCount}</strong></td>
</tr>`
    )
    .join("\n");
  return `<div class="card">
  <p style="margin-bottom:0.75rem;font-size:0.85rem;color:var(--text-muted)">Max reachable: <strong>${result.maxReachable}</strong> functions within ${result.depth} hops. ${result.totalWithCallers} changed functions have downstream callers.</p>
  <table class="gap-table">
    <thead><tr><th>Function</th><th>File</th><th>Reachable</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

function renderCoverageContent(gaps) {
  if (!gaps || gaps.uncovered.length === 0) {
    const total = gaps ? gaps.totalChanged : 0;
    return `<div class="card"><p style="font-size:0.875rem;color:var(--text-muted)">All ${total} changed function${total !== 1 ? "s" : ""} have test coverage.</p></div>`;
  }
  const rows = gaps.uncovered
    .map(
      (fn) => `<tr>
  <td class="fn-name">${escapeHtml(fn.name)}</td>
  <td class="file-path">${escapeHtml(fn.filePath)}</td>
  <td>${fn.linesStart}–${fn.linesEnd}</td>
</tr>`
    )
    .join("\n");
  return `<div class="card">
  <p style="margin-bottom:0.75rem;font-size:0.85rem;color:var(--text-muted)">${gaps.totalCovered} of ${gaps.totalChanged} changed functions covered — ${gaps.uncovered.length} gap${gaps.uncovered.length !== 1 ? "s" : ""}</p>
  <table class="gap-table">
    <thead><tr><th>Function</th><th>File</th><th>Lines</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

function renderCompletenessCards(results) {
  if (!results || results.length === 0) {
    return '<div class="empty-state">No completeness checks configured.</div>';
  }
  return results
    .map((result) => {
      const pct = Math.round(result.score * 100);
      const items = [
        ...result.present.map(
          (e) =>
            `<li><span class="icon icon-pass">✓</span><span class="edge-label">${escapeHtml(e)}</span></li>`
        ),
        ...result.missing.map(
          (e) =>
            `<li><span class="icon icon-fail">✗</span><span class="edge-label">${escapeHtml(e)}</span></li>`
        ),
      ].join("\n");
      return `<div class="card">
  <h3>${escapeHtml(result.node)}</h3>
  <div class="score-bar">
    <div class="bar"><div class="bar-fill ${scoreClass(result.score)}" style="width:${pct}%"></div></div>
    <span class="pct">${pct}%</span>
  </div>
  <ul class="checklist">${items}</ul>
</div>`;
    })
    .join("\n");
}

function renderGraphStats(graphStats) {
  const stats = graphStats || {};
  const bd = stats.breakdown || {};
  return `<div class="stats-grid">
  <div class="stat-box"><div class="value">${stats.vertices || 0}</div><div class="label">Vertices</div></div>
  <div class="stat-box"><div class="value">${stats.edges || 0}</div><div class="label">Edges</div></div>
  <div class="stat-box"><div class="value">${bd.files || 0}</div><div class="label">Files</div></div>
  <div class="stat-box"><div class="value">${bd.functions || 0}</div><div class="label">Functions</div></div>
  <div class="stat-box"><div class="value">${bd.types || 0}</div><div class="label">Types</div></div>
  <div class="stat-box"><div class="value">${bd.calls || 0}</div><div class="label">Call Edges</div></div>
</div>`;
}

function renderAppendixStructural(evidence) {
  const { graphStats, checks, guidedWalk, meta } = evidence;
  const parts = [];

  parts.push(`<h3>Graph Statistics</h3>${renderGraphStats(graphStats)}`);

  if (guidedWalk && guidedWalk.length > 0) {
    parts.push(`<h3>File-by-File Breakdown</h3>${renderGuidedWalk(guidedWalk, meta.pr)}`);
  }

  parts.push(`<h3>Coverage Gaps</h3>${renderCoverageContent(checks.coverageGaps)}`);
  parts.push(`<h3>Structural Hotspots</h3>${renderCentrality(checks.centrality)}`);
  parts.push(`<h3>Blast Radius</h3>${renderBlastRadius(checks.blastRadius)}`);

  if (checks.completeness && checks.completeness.length > 0) {
    parts.push(`<h3>Completeness Checks</h3>${renderCompletenessCards(checks.completeness)}`);
  }

  return parts.join("\n");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render an evidence package to a self-contained HTML page.
 *
 * @param {EvidencePackage} evidence - Structured evidence from review.js
 * @param {object} [narrative]       - Agent-provided content (structured data, not HTML)
 *
 * Narrative schema:
 *   summary:             string[]    — paragraph strings
 *   guidedWalk:          Array<{ filePath, what, attention?, functions? }>
 *   functionalTest:      { layers, reasoning, results: [{scenario, result, note?}], observations? }
 *   findings:            Array<{ title, filePath?, snippet?, concern, fix?, structuralContext? }>
 *   openQuestions:       string[]
 *   appendixFunctional:  { environment?, tests: [{name, language, script, output}] }
 *
 * @returns {string} Complete HTML document
 */
export function render(evidence, narrative = {}) {
  const { meta, graphStats, checks, guidedWalk, discussions } = evidence;
  const clusters = checks?.clusters || {};
  const clusterCount = clusters.clusterCount || 0;

  let html = TEMPLATE;

  // Header scalars
  html = html.replace(/\{\{pr\}\}/g, escapeHtml(String(meta.pr)));
  html = html.replace(/\{\{title\}\}/g, escapeHtml(meta.title));
  html = html.replace(/\{\{domain\}\}/g, escapeHtml(meta.domain));
  html = html.replace(/\{\{timestamp\}\}/g, escapeHtml(meta.timestamp));
  html = html.replace(/\{\{meta\.filesChanged\}\}/g, String(meta.filesChanged ?? 0));
  html = html.replace(/\{\{meta\.linesAdded\}\}/g, String(meta.linesAdded ?? 0));
  html = html.replace(/\{\{meta\.linesDeleted\}\}/g, String(meta.linesDeleted ?? 0));
  html = html.replace(/\{\{meta\.clusterCount\}\}/g, String(clusterCount));
  html = html.replace(/\{\{meta\.clusterPlural\}\}/g, clusterCount !== 1 ? "s" : "");
  html = html.replace(/\{\{playbook_badges\}\}/g, renderPlaybookBadges(meta.domain));

  // Narrative sections (structured data → deterministic HTML)
  html = html.replace(/\{\{narrative_summary\}\}/g, renderNarrativeSummary(narrative.summary));
  html = html.replace(/\{\{narrative_guided_walk\}\}/g, renderNarrativeGuidedWalk(narrative.guidedWalk));
  html = html.replace(/\{\{functional_test\}\}/g, renderNarrativeFunctionalTest(narrative.functionalTest));
  html = html.replace(/\{\{findings\}\}/g, renderNarrativeFindings(narrative.findings));
  html = html.replace(/\{\{open_questions\}\}/g, renderNarrativeOpenQuestions(narrative.openQuestions));
  html = html.replace(/\{\{appendix_functional\}\}/g, renderNarrativeAppendixFunctional(narrative.appendixFunctional));

  // Auto-rendered structural sections
  html = html.replace(/\{\{context_content\}\}/g, renderDiscussions(discussions));
  html = html.replace(/\{\{clusters_content\}\}/g, renderClusters(checks.clusters));
  html = html.replace(/\{\{appendix_structural\}\}/g, renderAppendixStructural(evidence));

  return html;
}
