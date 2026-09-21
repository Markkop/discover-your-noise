export function wantsStream(body, acceptHeader) {
  if (body?.stream === true) return true;
  return String(acceptHeader ?? "").includes("text/event-stream");
}

export function streamAnalyze(run) {
  const encoder = new TextEncoder();
  let streamController;

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
    },
  });

  const send = (event, data) => {
    streamController.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
  };

  (async () => {
    try {
      const onProgress = (progress) => send("progress", progress);
      const result = await run(onProgress);
      send("complete", result);
    } catch (error) {
      send("error", { error: error.message });
    } finally {
      streamController.close();
    }
  })();

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
