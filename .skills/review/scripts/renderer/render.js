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
  <ul class="checklist">
    ${items}
  </ul>
</div>`;
    })
    .join("\n");
}

function renderCoverageContent(gaps) {
  if (!gaps || gaps.uncovered.length === 0) {
    const total = gaps ? gaps.totalChanged : 0;
    return `<div class="card">
  <p class="empty-state">All ${total} changed function${total !== 1 ? "s" : ""} have test coverage.</p>
</div>`;
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

  const summary = `${gaps.totalCovered} of ${gaps.totalChanged} changed functions covered — ${gaps.uncovered.length} gap${gaps.uncovered.length !== 1 ? "s" : ""}`;

  return `<div class="card">
  <p style="margin-bottom:0.75rem;color:var(--text-muted);font-size:0.875rem">${escapeHtml(summary)}</p>
  <table class="gap-table">
    <thead><tr><th>Function</th><th>File</th><th>Lines</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

function renderGuidedWalk(sections, pr) {
  if (!sections || sections.length === 0) {
    return '<div class="empty-state">No guided walk sections generated.</div>';
  }

  return sections.map((section, i) => {
    const badge = section.attention
      ? '<span class="badge badge-attention">Attention</span>'
      : '';
    const blastBadge = section.maxBlast > 5
      ? `<span class="badge badge-blast">Blast: ${section.maxBlast}</span>`
      : '';

    const fnList = section.functions.map(f => {
      const hotspot = f.isHotspot ? '<span class="icon icon-fail">●</span>' : '';
      const blast = f.blastRadius > 0 ? `<span class="blast-count">(${f.blastRadius} callers)</span>` : '';
      return `<li>${hotspot}<code>${escapeHtml(f.name)}</code>${blast} <span class="lines">L${f.linesStart}–${f.linesEnd}</span></li>`;
    }).join("\n");

    const snippetHtml = section.snippet
      ? `<details class="snippet-details"><summary>View code</summary><pre><code>${escapeHtml(section.snippet)}</code></pre></details>`
      : '';

    return `<div class="walk-section${section.attention ? ' walk-attention' : ''}">
  <div class="walk-header">
    <span class="walk-number">${i + 1}</span>
    <h3 class="walk-file">${escapeHtml(section.filePath.split('/').slice(-2).join('/'))}</h3>
    ${badge}${blastBadge}
  </div>
  <p class="walk-narrative">${escapeHtml(section.narrative)}</p>
  <ul class="walk-functions">${fnList}</ul>
  ${snippetHtml}
  <a class="pr-link" href="${section.prLink}" target="_blank">View in PR →</a>
</div>`;
  }).join("\n");
}

function renderCentrality(result) {
  if (!result || result.hotspots.length === 0) {
    return '<div class="empty-state">No high-centrality functions found.</div>';
  }

  const rows = result.hotspots.map(h => `<tr>
  <td class="fn-name">${escapeHtml(h.name)}</td>
  <td class="file-path">${escapeHtml(h.filePath.split('/').slice(-2).join('/'))}</td>
  <td class="num">${h.inDegree}</td>
  <td class="num">${h.outDegree}</td>
  <td class="num"><strong>${h.totalDegree}</strong></td>
</tr>`).join("\n");

  return `<div class="card">
  <p style="margin-bottom:0.75rem;color:var(--text-muted);font-size:0.875rem">${result.aboveThreshold} functions above centrality threshold (of ${result.totalAnalyzed} analyzed)</p>
  <table class="gap-table">
    <thead><tr><th>Function</th><th>File</th><th>In</th><th>Out</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

/**
 * Render an evidence package to a self-contained HTML page.
 *
 * @param {EvidencePackage} evidence - Structured evidence data
 * @returns {string} - Complete HTML document as a string
 */
export function render(evidence) {
  const { meta, summary, graphStats, checks, guidedWalk } = evidence;

  let html = TEMPLATE;

  html = html.replace(/\{\{pr\}\}/g, escapeHtml(String(meta.pr)));
  html = html.replace(/\{\{title\}\}/g, escapeHtml(meta.title));
  html = html.replace(/\{\{domain\}\}/g, escapeHtml(meta.domain));
  html = html.replace(/\{\{timestamp\}\}/g, escapeHtml(meta.timestamp));
  html = html.replace(/\{\{summary\}\}/g, escapeHtml(summary));

  const stats = graphStats || { vertices: 0, edges: 0, breakdown: {} };
  const bd = stats.breakdown || {};
  html = html.replace(/\{\{stats\.vertices\}\}/g, String(stats.vertices));
  html = html.replace(/\{\{stats\.edges\}\}/g, String(stats.edges));
  html = html.replace(/\{\{stats\.files\}\}/g, String(bd.files || 0));
  html = html.replace(/\{\{stats\.functions\}\}/g, String(bd.functions || 0));
  html = html.replace(/\{\{stats\.types\}\}/g, String(bd.types || 0));
  html = html.replace(/\{\{stats\.calls\}\}/g, String(bd.calls || 0));

  html = html.replace(
    /\{\{guided_walk\}\}/g,
    renderGuidedWalk(guidedWalk, meta.pr)
  );
  html = html.replace(
    /\{\{completeness_cards\}\}/g,
    renderCompletenessCards(checks.completeness)
  );
  html = html.replace(
    /\{\{coverage_content\}\}/g,
    renderCoverageContent(checks.coverageGaps)
  );
  html = html.replace(
    /\{\{centrality_content\}\}/g,
    renderCentrality(checks.centrality)
  );

  return html;
}
