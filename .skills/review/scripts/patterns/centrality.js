import gremlin from "gremlin";

/**
 * Identify high-centrality functions — those with many incoming and outgoing
 * call edges. These are structural hotspots where changes propagate widely.
 *
 * @param {object} g - gremlin-js GraphTraversalSource
 * @param {object} params
 * @param {boolean} [params.changedOnly] - Only check changed functions (default: true)
 * @param {number} [params.topN] - Return top N results (default: 10)
 * @param {number} [params.minDegree] - Minimum combined in+out degree to include (default: 3)
 * @returns {Promise<CentralityResult>}
 */
export async function highCentrality(g, params = {}) {
  const changedOnly = params.changedOnly !== false;
  const topN = params.topN || 10;
  const minDegree = params.minDegree || 3;

  let traversal = g.V().hasLabel("Function");
  if (changedOnly) {
    traversal = traversal.has("changed", true);
  }

  const functions = await traversal.elementMap().toList();
  const results = [];

  for (const fnMap of functions) {
    const vertexId = fnMap.get(gremlin.process.t.id);

    const inDegree = await g.V(vertexId).inE("calls").count().next();
    const outDegree = await g.V(vertexId).outE("calls").count().next();

    const inCount = inDegree.value;
    const outCount = outDegree.value;
    const totalDegree = inCount + outCount;

    if (totalDegree >= minDegree) {
      results.push({
        name: fnMap.get("name"),
        filePath: fnMap.get("filePath"),
        signature: fnMap.get("signature"),
        linesStart: fnMap.get("lines_start"),
        linesEnd: fnMap.get("lines_end"),
        inDegree: inCount,
        outDegree: outCount,
        totalDegree,
      });
    }
  }

  results.sort((a, b) => b.totalDegree - a.totalDegree);

  return {
    hotspots: results.slice(0, topN),
    totalAnalyzed: functions.length,
    aboveThreshold: results.length,
  };
}
