import { existsSync } from 'node:fs';

// When the coach's Ollama/vLLM test fails with a network error, the raw
// message ("fetch failed") says nothing about the usual cause: Patzer runs in
// Docker, where `localhost` is the container itself, and Ollama by default
// only listens on the host's own loopback. The UI turns these codes into a
// short how-to (see `setup.llmHint.*` in the locales).
export type ConnectionHint = 'docker_localhost' | 'unreachable' | 'lmstudio_docker_localhost' | 'lmstudio_unreachable';

// Docker writes /.dockerenv into every container, Podman /run/.containerenv.
const IN_CONTAINER = existsSync('/.dockerenv') || existsSync('/run/.containerenv');

function isLoopback(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

// What Node's fetch throws when nothing answers: "fetch failed" (refused,
// unknown host, no route) or the AbortSignal.timeout message. Anything else —
// an HTTP status, a body that isn't JSON — means something did answer.
const NO_ANSWER = /^fetch failed$|timeout|timed out/i;

/** Hint for a failed connection test, given the error the test returned. */
export function connectionHint(url: string, error: string, inContainer = IN_CONTAINER, provider = 'ollama'): ConnectionHint | undefined {
  if (!NO_ANSWER.test(error)) return undefined;
  let host: string;
  try { host = new URL(url).hostname; } catch { return undefined; }
  const isLoop = inContainer && isLoopback(host);
  if (provider === 'lmstudio') {
    return isLoop ? 'lmstudio_docker_localhost' : 'lmstudio_unreachable';
  }
  return isLoop ? 'docker_localhost' : 'unreachable';
}
