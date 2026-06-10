import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { get } from "node:http";

const exec = promisify(execFile);

const DEFAULT_IMAGE = "tinkerpop/gremlin-server:3.8.1";
const DEFAULT_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 500;

/**
 * Start a Gremlin Server Docker container with TinkerGraph.
 * Uses a random available port. Polls until server is ready.
 *
 * @param {object} options
 * @param {string} [options.image] - Docker image (default: "tinkerpop/gremlin-server:4.0.1")
 * @param {number} [options.timeoutMs] - Max wait for readiness (default: 30000)
 * @returns {Promise<ServerHandle>}
 */
export async function startServer(options = {}) {
  const image = options.image || DEFAULT_IMAGE;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  const port = await findAvailablePort();

  const { stdout } = await exec("docker", [
    "run", "-d",
    "--name", `pr-review-graph-${port}`,
    "-p", `${port}:8182`,
    image,
  ]);

  const containerId = stdout.trim();
  const url = `ws://localhost:${port}/gremlin`;

  const handle = { port, containerId, url };

  try {
    await waitForReady(port, timeoutMs);
  } catch (err) {
    await stopServer(handle).catch(() => {});
    throw err;
  }

  return handle;
}

/**
 * Stop and remove the Gremlin Server container.
 *
 * @param {ServerHandle} handle - Handle returned by startServer
 * @returns {Promise<void>}
 */
export async function stopServer(handle) {
  await exec("docker", ["stop", handle.containerId]).catch(() => {});
  await exec("docker", ["rm", handle.containerId]).catch(() => {});
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function waitForReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    function poll() {
      if (Date.now() > deadline) {
        reject(new Error(`Gremlin Server did not become ready within ${timeoutMs}ms`));
        return;
      }

      const req = get(`http://localhost:${port}/gremlin`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        setTimeout(poll, POLL_INTERVAL_MS);
      });
    }

    poll();
  });
}
