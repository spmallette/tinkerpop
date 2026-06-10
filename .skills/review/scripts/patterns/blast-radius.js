import gremlin from "gremlin";

/**
 * Calculate blast radius — how many functions are reachable downstream
 * from changed functions via call edges. High blast radius means a change
 * here affects many callers.
 *
 * @param {object} g - gremlin-js GraphTraversalSource
 * @param {object} params
 * @param {number} [params.depth] - Max hops to traverse (default: 3)
 * @param {boolean} [params.changedOnly] - Start from changed functions only (default: true)
 * @returns {Promise<BlastRadiusResult>}
 */
export async function blastRadius(g, params = {}) {
  const depth = params.depth || 3;
  const changedOnly = params.changedOnly !== false;

  let traversal = g.V().hasLabel("Function");
  if (changedOnly) {
    traversal = traversal.has("changed", true);
  }

  const functions = await traversal.elementMap().toList();
  const results = [];

  for (const fnMap of functions) {
    const vertexId = fnMap.get(gremlin.process.t.id);

    const reachable = await g.V(vertexId)
      .repeat(gremlin.process.statics.in_("calls"))
      .times(depth)
      .emit()
      .dedup()
      .count()
      .next();

    const count = reachable.value;
    if (count > 0) {
      results.push({
        name: fnMap.get("name"),
        filePath: fnMap.get("filePath"),
        signature: fnMap.get("signature"),
        linesStart: fnMap.get("lines_start"),
        linesEnd: fnMap.get("lines_end"),
        reachableCount: count,
        depth,
      });
    }
  }

  results.sort((a, b) => b.reachableCount - a.reachableCount);

  return {
    functions: results,
    maxReachable: results.length > 0 ? results[0].reachableCount : 0,
    totalWithCallers: results.length,
    depth,
  };
}
