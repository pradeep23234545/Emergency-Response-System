import type { Response } from 'express';

/**
 * Server-Sent Events hub. SSE fits this workload well: the server pushes a
 * snapshot every simulation tick, clients send commands over plain REST, and
 * EventSource reconnects automatically and carries the session cookie.
 */
export class RealtimeHub {
  private clients = new Set<Response>();
  private heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => {
      for (const res of this.clients) res.write(': keep-alive\n\n');
    }, 15_000);
    this.heartbeat.unref();
  }

  get size() {
    return this.clients.size;
  }

  attach(res: Response, initial?: { event: string; data: unknown }) {
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    if (initial) this.write(res, initial.event, initial.data);
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  broadcast(event: string, data: unknown) {
    if (!this.clients.size) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) res.write(payload);
  }

  private write(res: Response, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
