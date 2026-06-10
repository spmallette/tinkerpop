import gremlin from "gremlin";

/**
 * Find orphan vertices — nodes that are missing expected relationships.
 * Useful for detecting undocumented functions, untested steps, or
 * disconnected code.
 *
 * @param {object} g - gremlin-js GraphTraversalSource
 * @param {object} params
 * @param {string} params.vertexLabel - Label to check (e.g., "Step", "Function")
 * @param {string} params.expectedEdge - Edge label that should exist
 * @param {string} [params.direction] - "in" or "out" (default: "in")
 * @param {boolean} [params.changedOnly] - Only check changed vertices (default: false)
 * @returns {Promise<OrphanResult>}
 */
export async function orphans(g, params) {
  const { vertexLabel, expectedEdge } = params;
  const direction = params.direction || "in";
  const changedOnly = params.changedOnly || false;

  let traversal = g.V().hasLabel(vertexLabel);
  if (changedOnly) {
    traversal = traversal.has("changed", true);
  }

  const vertices = await traversal.elementMap().toList();
  const orphaned = [];

  for (const vMap of vertices) {
    const vertexId = vMap.get(gremlin.process.t.id);

    let edgeTraversal;
    if (direction === "in") {
      edgeTraversal = g.V(vertexId).inE(expectedEdge);
    } else {
      edgeTraversal = g.V(vertexId).outE(expectedEdge);
    }

    const edges = await edgeTraversal.limit(1).toList();
    if (edges.length === 0) {
      orphaned.push({
        name: vMap.get("name") || vMap.get("path") || String(vertexId),
        label: vertexLabel,
        filePath: vMap.get("filePath") || vMap.get("path"),
        missingEdge: `${direction}:${expectedEdge}`,
      });
    }
  }

  return {
    orphaned,
    totalChecked: vertices.length,
    totalOrphaned: orphaned.length,
  };
}
