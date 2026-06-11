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

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import gremlin from "gremlin";

import { startServer, stopServer } from "./infrastructure/docker.js";
import { extract } from "./extraction/tree-sitter.js";
import { populate } from "./graph/populate.js";
import { completeness } from "./patterns/completeness.js";
import { coverageGaps } from "./patterns/coverage-gaps.js";
import { highCentrality } from "./patterns/centrality.js";
import { blastRadius } from "./patterns/blast-radius.js";
import { createPrDiscussion } from "./enrichment/api.js";
import { discoverDiscussions } from "./discovery/discussions.js";

const exec = promisify(execFile);

const LANGUAGE_HINTS = {
  dart: "dart",
  java: "java",
  go: "go",
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cs: "csharp",
};

function log(msg) {
  process.stdout.write(`[review] ${msg}\n`);
}

function detectLanguage(changedFiles) {
  const extCounts = new Map();
  for (const file of changedFiles) {
    const ext = extname(file).slice(1);
    if (LANGUAGE_HINTS[ext]) {
      extCounts.set(LANGUAGE_HINTS[ext], (extCounts.get(LANGUAGE_HINTS[ext]) || 0) + 1);
    }
  }

  let best = null;
  let bestCount = 0;
  for (const [lang, count] of extCounts) {
    if (count > bestCount) {
      best = lang;
      bestCount = count;
    }
  }
  return best || "java";
}

async function getChangedFiles(repoPath, prBranch, remote = "upstream") {
  const { stdout: baseCommit } = await exec(
    "git", ["merge-base", prBranch, `${remote}/master`],
    { cwd: repoPath }
  );
  const base = baseCommit.trim();

  const { stdout: diffOutput } = await exec(
    "git", ["diff", "--name-only", `${base}...${prBranch}`],
    { cwd: repoPath }
  );
  return diffOutput.trim().split("\n").filter(Boolean);
}

async function classifyDomain(changedFiles) {
  const paths = changedFiles.join("\n").toLowerCase();
  if (paths.includes("gremlin-dart") || paths.includes("gremlin-swift") || paths.includes("gremlin-rust")) {
    return "glv";
  }
  if (paths.includes("gremlin-go/") || paths.includes("gremlin-python/") || paths.includes("gremlin-dotnet/")) {
    return "glv";
  }
  if (paths.includes("gremlin-language/") || paths.includes("grammar")) {
    return "grammar";
  }
  if (changedFiles.length <= 10) {
    return "bug-fix";
  }
  return "general";
}

import { readFile } from "node:fs/promises";

function extractKeywords(changedFiles, prTitle) {
  const keywords = new Set();
  for (const file of changedFiles) {
    const parts = file.split("/");
    const filename = parts[parts.length - 1].replace(/\.\w+$/, "");
    if (filename.length > 3 && !["index", "package", "pom", "build"].includes(filename.toLowerCase())) {
      keywords.add(filename);
    }
  }
  const titleWords = prTitle.split(/[\s\-_:]+/).filter((w) => w.length > 3 && !/^\d+$/.test(w));
  for (const w of titleWords.slice(0, 3)) {
    keywords.add(w);
  }
  return [...keywords].slice(0, 6);
}

async function buildGuidedWalk(extraction, centralityResult, blastResult, pr, worktreePath) {
  const hotspotNames = new Set(centralityResult.hotspots.map(h => h.name));
  const blastMap = new Map(blastResult.functions.map(f => [f.name + ":" + f.filePath, f.reachableCount]));

  const fileGroups = new Map();
  for (const fn of extraction.functions) {
    if (!fn.changed) continue;
    if (!fileGroups.has(fn.filePath)) {
      fileGroups.set(fn.filePath, []);
    }
    fileGroups.get(fn.filePath).push(fn);
  }

  const sections = [];

  for (const [filePath, functions] of fileGroups) {
    const maxBlast = Math.max(0, ...functions.map(f => blastMap.get(f.name + ":" + filePath) || 0));
    const hasHotspot = functions.some(f => hotspotNames.has(f.name));

    functions.sort((a, b) => {
      const aBlast = blastMap.get(a.name + ":" + filePath) || 0;
      const bBlast = blastMap.get(b.name + ":" + filePath) || 0;
      return bBlast - aBlast;
    });

    let snippet = "";
    const topFn = functions[0];
    try {
      const content = await readFile(join(worktreePath, filePath), "utf-8");
      const lines = content.split("\n");
      const start = Math.max(0, topFn.linesStart - 1);
      const end = Math.min(lines.length, topFn.linesEnd);
      snippet = lines.slice(start, end).join("\n");
    } catch { snippet = ""; }

    sections.push({
      filePath,
      narrative: hasHotspot
        ? `High-centrality code — changes here propagate widely. Contains ${functions.length} modified function${functions.length > 1 ? "s" : ""}.`
        : `Contains ${functions.length} modified function${functions.length > 1 ? "s" : ""}.`,
      functions: functions.slice(0, 5).map(f => ({
        name: f.name,
        signature: f.signature,
        linesStart: f.linesStart,
        linesEnd: f.linesEnd,
        isHotspot: hotspotNames.has(f.name),
        blastRadius: blastMap.get(f.name + ":" + filePath) || 0,
      })),
      snippet: snippet.slice(0, 1500),
      prLink: `https://github.com/apache/tinkerpop/pull/${pr}/files#diff-${Buffer.from(filePath).toString("base64url")}`,
      attention: hasHotspot,
      maxBlast,
    });
  }

  sections.sort((a, b) => {
    if (a.attention !== b.attention) return a.attention ? -1 : 1;
    return b.maxBlast - a.maxBlast;
  });

  return sections;
}

/**
 * Execute a graph-based review of a PR.
 * This is the skill entry point.
 *
 * @param {object} params
 * @param {number} params.pr - PR number
 * @param {string} params.repoPath - Path to the git repository
 * @param {object} [params.options]
 * @param {string} [params.options.outputPath] - Where to write the JSON (default: ./pr-review-${pr}.json)
 * @returns {Promise<string>} - Path to the generated JSON file
 */
export async function review(params) {
  const { pr, repoPath, options = {} } = params;
  const outputPath = options.outputPath || join(repoPath, `pr-review-${pr}.json`);
  const prBranch = `pr-review/${pr}`;
  const worktreePath = `/tmp/pr-review-${pr}`;

  let handle = null;
  let worktreeCreated = false;

  try {
    log(`PR #${pr} — fetching...`);
    const remote = options.remote || "upstream";
    await exec("git", ["fetch", remote, `pull/${pr}/head:${prBranch}`], { cwd: repoPath });

    await exec("git", ["worktree", "add", worktreePath, prBranch], { cwd: repoPath });
    worktreeCreated = true;

    const changedFiles = await getChangedFiles(repoPath, prBranch, remote);
    const language = detectLanguage(changedFiles);
    const domain = await classifyDomain(changedFiles);
    log(`PR #${pr} — classified as: ${domain} (${language}, ${changedFiles.length} files changed)`);

    log(`Starting Gremlin Server...`);
    handle = await startServer();
    log(`Gremlin Server ready on port ${handle.port}`);

    const connection = new gremlin.driver.DriverRemoteConnection(handle.url);
    const g = gremlin.process.traversal().withRemote(connection);

    log(`Phase 1: Extracting structure (${language})...`);
    const extraction = await extract(worktreePath, language, { changedFiles });
    log(`Phase 1 complete: ${extraction.files.length} files, ${extraction.functions.length} functions, ${extraction.types.length} types`);

    log(`Populating graph...`);
    const graphStats = await populate(g, extraction);
    log(`Graph populated: ${graphStats.vertices} vertices, ${graphStats.edges} edges`);

    const { stdout: prTitle } = await exec(
      "git", ["log", "-1", "--format=%s", prBranch],
      { cwd: repoPath }
    ).catch(() => ({ stdout: `PR #${pr}` }));

    await createPrDiscussion(g, pr, prTitle.trim(), "");

    log(`Discovering discussions...`);
    const { stdout: diffText } = await exec(
      "git", ["diff", "--unified=0", `${await exec("git", ["merge-base", prBranch, `${remote}/master`], { cwd: repoPath }).then(r => r.stdout.trim())}...${prBranch}`],
      { cwd: repoPath }
    ).catch(() => ({ stdout: "" }));

    const prKeywords = extractKeywords(changedFiles, prTitle.trim());
    const discussions = await discoverDiscussions({
      pr,
      prTitle: prTitle.trim(),
      prBody: "",
      diff: diffText,
      keywords: prKeywords,
      repoPath,
    });
    log(`  jiras: ${discussions.jiras.length} found${discussions.jiraMissing ? " (none referenced)" : ""}`);
    log(`  pr comments: ${discussions.prComments.issue.length} issue + ${discussions.prComments.review.length} review`);
    log(`  dev list: ${discussions.devList.length} found${discussions.devListSearchPerformed ? ` (searched: ${prKeywords.join(", ")})` : ""}`);
    log(`  proposals: ${discussions.proposals.length} found`);

    log(`Running checks...`);
    const completenessResults = await completeness(g, {
      vertexLabel: "File",
      expectedEdges: ["out:defines"],
    });

    const coverageResult = await coverageGaps(g, { changedOnly: true });
    const centralityResult = await highCentrality(g, { changedOnly: true, topN: 10, minDegree: 3 });
    const blastResult = await blastRadius(g, { depth: 3, changedOnly: true });
    log(`  completeness: ${completenessResults.filter(r => r.missing.length > 0).length} gaps found`);
    log(`  coverage_gaps: ${coverageResult.uncovered.length} functions without tests`);
    log(`  centrality: ${centralityResult.aboveThreshold} hotspots`);
    log(`  blast_radius: max ${blastResult.maxReachable} reachable`);

    log(`Building guided walk...`);
    const guidedWalk = await buildGuidedWalk(extraction, centralityResult, blastResult, pr, worktreePath);

    const evidence = {
      meta: {
        pr,
        title: prTitle.trim(),
        domain,
        timestamp: new Date().toISOString(),
      },
      summary: `Graph-based structural analysis of PR #${pr}. Detected ${changedFiles.length} changed files in language: ${language}. Domain classification: ${domain}.`,
      graphStats,
      checks: {
        completeness: completenessResults,
        coverageGaps: coverageResult,
        centrality: centralityResult,
        blastRadius: blastResult,
      },
      discussions,
      guidedWalk,
    };

    const jsonPath = outputPath.replace(/\.html$/, ".json");
    await writeFile(jsonPath, JSON.stringify(evidence, null, 2), "utf-8");

    await connection.close();
    log(`Done. Evidence: ${jsonPath}`);
    return jsonPath;
  } finally {
    if (handle) {
      await stopServer(handle).catch(() => {});
    }
    if (worktreeCreated) {
      await exec("git", ["worktree", "remove", "--force", worktreePath], { cwd: repoPath }).catch(() => {});
      await exec("git", ["branch", "-D", prBranch], { cwd: repoPath }).catch(() => {});
    }
  }
}

if (process.argv[1] && basename(process.argv[1]) === "review.js") {
  const pr = parseInt(process.argv[2], 10);
  if (!pr || isNaN(pr)) {
    console.error("Usage: node review.js <pr-number> [repo-path]");
    process.exit(1);
  }
  const repoPath = process.argv[3] || process.cwd();
  review({ pr, repoPath }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
