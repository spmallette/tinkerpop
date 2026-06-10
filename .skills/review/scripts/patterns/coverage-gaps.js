import gremlin from "gremlin";

/**
 * Find changed functions that have no incoming 'tests' edge.
 *
 * @param {object} g - gremlin-js GraphTraversalSource
 * @param {object} params
 * @param {boolean} [params.changedOnly] - Only check functions with changed=true (default: true)
 * @returns {Promise<CoverageGapResult>}
 */
export async function coverageGaps(g, params = {}) {
  const changedOnly = params.changedOnly !== false;

  let traversal = g.V().hasLabel("Function");
  if (changedOnly) {
    traversal = traversal.has("changed", true);
  }

  const functions = await traversal.elementMap().toList();

  const testFilePaths = new Set(
    (await g.V().hasLabel("Test").values("filePath").toList())
  );

  const nonTestFunctions = functions.filter(
    (fnMap) => !testFilePaths.has(fnMap.get("filePath"))
  );

  const totalChanged = nonTestFunctions.length;
  const uncovered = [];

  for (const fnMap of nonTestFunctions) {
    const vertexId = fnMap.get(gremlin.process.t.id);
    const hasTest = await g.V(vertexId).inE("tests").limit(1).toList();

    if (hasTest.length === 0) {
      uncovered.push({
        name: fnMap.get("name"),
        signature: fnMap.get("signature"),
        filePath: fnMap.get("filePath"),
        linesStart: fnMap.get("lines_start"),
        linesEnd: fnMap.get("lines_end"),
      });
    }
  }

  const totalCovered = totalChanged - uncovered.length;

  return { uncovered, totalChanged, totalCovered };
}
