import { subscribeAnalysis } from "@/lib/store";
import type { PythiaAnalysisState } from "@/lib/types";
import { requireAnalysis } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events stream for a single analysis. Emits the full
 * PythiaAnalysisState JSON on every store update. Closes itself once the
 * analysis reaches a terminal state (complete or error) so the client
 * doesn't keep a dangling connection.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const got = await requireAnalysis(params);
  if (got instanceof Response) return got;
  const { id, analysis: initial } = got;

  const encoder = new TextEncoder();

  // These are assigned inside `start` and read from `cancel`, so hoist
  // them into the outer closure.
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (state: PythiaAnalysisState) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
        if (state.status === "complete" || state.status === "error") {
          cleanup();
        }
      };

      // Prime with current state so the client renders immediately.
      send(initial);

      const unsubscribe = subscribeAnalysis(id, send);

      // Heartbeat keeps proxies / load balancers from idling the connection.
      const heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, HEARTBEAT_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
