/**
 * gateway/stream-client.ts
 *
 * H2-side helper to POST stdout chunks to H1's stream server.
 *
 * Used by `hh watch` — as the executor produces stdout, each chunk is
 * fire-and-forgotten to H1 via this client so the operator can follow
 * progress in real-time with `hh send --wait`.
 *
 * ## Integration with watch.ts
 *
 *   // Read stream URL from wake message env vars (injected by hh send)
 *   const streamUrl = process.env.HH_STREAM_URL;
 *   const streamToken = process.env.HH_STREAM_TOKEN;
 *
 *   // As executor produces stdout:
 *   child.stdout.on("data", (data) => {
 *     const chunk = data.toString();
 *     stdout += chunk;
 *     if (streamUrl && streamToken) {
 *       postChunk(streamUrl, streamToken, { task_id, seq: seq++, chunk });
 *     }
 *   });
 *
 *   // On completion, send done marker:
 *   postChunk(streamUrl, streamToken, { task_id, seq: seq++, chunk: "", done: true });
 *
 * ## Design notes
 * - Fire-and-forget: postChunk never throws; errors are silently swallowed
 * - No ordering guarantee: the seq field lets H1 re-order if needed
 * - Batching: caller may buffer small chunks before posting (optional)
 * - Token reuse: same gateway_token as used for /result and /capabilities
 */

import type { StreamChunkPayload } from "./stream-server.ts";

export interface PostChunkResult {
  ok: boolean;
  /** HTTP status code, or 0 on network error */
  status: number;
  error?: string;
}

/**
 * POST a single stdout chunk to H1's stream server.
 *
 * Fire-and-forget by default — set `throwOnError: true` only in tests.
 *
 * @param streamUrl  The URL from HH-Stream-URL in the wake message
 * @param token      The auth token from HH-Stream-Token in the wake message
 * @param payload    The chunk to send
 * @param throwOnError  If true, throws on HTTP error instead of returning {ok:false}
 */
export async function postChunk(
  streamUrl: string,
  token: string,
  payload: StreamChunkPayload,
  throwOnError = false,
): Promise<PostChunkResult> {
  try {
    const res = await fetch(streamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HH-Token": token,
      },
      body: JSON.stringify(payload),
      // Short timeout — if H1 is gone, don't block the executor
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const result: PostChunkResult = {
        ok: false,
        status: res.status,
        error: body || `HTTP ${res.status}`,
      };
      if (throwOnError) {
        throw new Error(result.error);
      }
      return result;
    }

    return { ok: true, status: res.status };
  } catch (err) {
    if (throwOnError) throw err;
    return { ok: false, status: 0, error: (err as Error).message };
  }
}

/**
 * Create a stateful chunk poster for a single task stream.
 * Tracks sequence numbers automatically.
 *
 * @example
 * const streamer = createChunkStreamer(streamUrl, streamToken, taskId);
 * child.stdout.on("data", (data) => void streamer.push(data.toString()));
 * await streamer.finish();  // posts done:true and flushes
 */
export function createChunkStreamer(
  streamUrl: string,
  token: string,
  taskId: string,
) {
  let seq = 0;
  const pending: Promise<PostChunkResult>[] = [];

  const push = (chunk: string): void => {
    if (!chunk) return;
    const p = postChunk(streamUrl, token, {
      task_id: taskId,
      seq: seq++,
      chunk,
    });
    pending.push(p);
    // Drain resolved promises to avoid unbounded memory growth
    pending.splice(0, pending.findIndex((p) => !p) + 1);
  };

  const finish = async (): Promise<void> => {
    // Send done marker
    await postChunk(streamUrl, token, {
      task_id: taskId,
      seq: seq++,
      chunk: "",
      done: true,
    });
    // Wait for any in-flight pushes (best-effort)
    await Promise.allSettled(pending);
  };

  return { push, finish, getSeq: () => seq };
}
