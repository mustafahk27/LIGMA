'use client';

import { useEffect } from 'react';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { ydoc } from './yjs';
import { useWsStore } from '../store/ws';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Resolve the WS origin for this tab.
 *
 * If `NEXT_PUBLIC_WS_URL` is unset, we use the **browser hostname** (not hard-coded
 * `localhost`) plus the API port from `NEXT_PUBLIC_API_URL`. That way opening the
 * app as `http://127.0.0.1:3000` or `http://192.168.x.x:3000` still connects to the
 * backend on the same machine (`:3001`), instead of a wrong host or failed upgrade (1006).
 */
function getWsBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const api = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:3001';
  let port = '3001';
  let wss = false;
  try {
    const u = new URL(api);
    wss = u.protocol === 'https:';
    port = u.port || (wss ? '443' : '80');
  } catch {
    /* keep defaults */
  }

  if (typeof window !== 'undefined') {
    const proto = wss ? 'wss:' : 'ws:';
    return `${proto}//${window.location.hostname}:${port}`;
  }

  return `${wss ? 'wss' : 'ws'}://localhost:${port}`;
}

/** Exponential backoff delays in ms. Caps at the last value. */
const BACKOFF_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

// ─── Awareness ────────────────────────────────────────────────────────────────

/**
 * A single Awareness instance shared for the lifetime of the page.
 * Other components (Cursors.tsx) subscribe to this directly.
 */
export const awareness = new awarenessProtocol.Awareness(ydoc);

// ─── Server message types (incoming) ─────────────────────────────────────────

type ServerMessage =
  | { type: 'init'; seq: number }
  | { type: 'synced'; seq: number }
  | { type: 'awareness'; data: number[] }
  | { type: 'rejected'; reason: string; nodeId?: string };

// ─── Provider class ───────────────────────────────────────────────────────────

class WsProvider {
  private ws: WebSocket | null = null;
  private roomId: string = '';
  private token: string = '';
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /** Set to true once we complete the initial full-state handshake */
  private initialised = false;

  constructor() {
    // ── Register Yjs + awareness listeners ONCE (not per reconnect) ──────────
    // Outgoing Yjs updates
    ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(update);
      }
    });

    // Outgoing awareness updates
    awareness.on(
      'update',
      (changes: { added: number[]; updated: number[]; removed: number[] }, _origin: unknown) => {
        const changedClients = [...changes.added, ...changes.updated, ...changes.removed];
        const encoded = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'awareness',
            data: Array.from(encoded),
          }));
        }
      }
    );
  }

  // ── Persistent reconnect state ──────────────────────────────────────────────
  private get lastSeqKey(): string {
    return `ligma:lastSeq:${this.roomId}`;
  }

  private get storedLastSeq(): number {
    try {
      return parseInt(localStorage.getItem(this.lastSeqKey) ?? '0', 10) || 0;
    } catch {
      return 0;
    }
  }

  private set storedLastSeq(seq: number) {
    try {
      localStorage.setItem(this.lastSeqKey, String(seq));
    } catch {
      // localStorage unavailable (SSR guard)
    }
    useWsStore.getState().setLastSeq(seq);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  connect(roomId: string, token: string): void {
    this.roomId = roomId;
    this.token = token;
    this.destroyed = false;
    this.clearRetryTimer();
    this.detachSocket();
    this.openSocket();
  }

  destroy(): void {
    this.destroyed = true;
    this.clearRetryTimer();
    this.detachSocket();
  }

  /** Drop the current socket without marking the provider destroyed (used before reconnect). */
  private detachSocket(): void {
    const old = this.ws;
    this.ws = null;
    if (!old) return;
    old.onopen = null;
    old.onclose = null;
    old.onerror = null;
    old.onmessage = null;
    try {
      old.close(1000, this.destroyed ? 'provider destroyed' : 'reconnect');
    } catch {
      /* already closed */
    }
  }

  // ── Socket lifecycle ────────────────────────────────────────────────────────

  private openSocket(): void {
    if (this.destroyed) return;

    this.detachSocket();

    const base = getWsBaseUrl();
    const q = encodeURIComponent(this.token);
    const url = `${base}/ws/${this.roomId}?token=${q}`;
    useWsStore.getState().setStatus('reconnecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
    } catch (err) {
      console.error('[ws-provider] Failed to construct WebSocket:', err);
      this.scheduleRetry();
      return;
    }

    this.ws = ws;

    ws.onopen = () => {
      console.log('[ws-provider] Connected');
      useWsStore.getState().setStatus('connected');
      this.retryCount = 0;

      // If we already went through initial sync before, reconnect with diff replay
      if (this.initialised && this.storedLastSeq > 0) {
        this.sendSyncRequest();
      }
      // Otherwise the server will send { type: 'init' } + binary state automatically

      // Re-broadcast the current local awareness so peers can render our cursor
      // immediately. The 'update' listener only fires on changes — without this,
      // an identity set before connect would never reach the server.
      if (awareness.getLocalState()) {
        const encoded = awarenessProtocol.encodeAwarenessUpdate(awareness, [
          awareness.clientID,
        ]);
        ws.send(JSON.stringify({
          type: 'awareness',
          data: Array.from(encoded),
        }));
      }
    };

    ws.onclose = (event) => {
      console.warn(`[ws-provider] Closed (code=${event.code})`);
      if (!this.destroyed) {
        useWsStore.getState().setStatus('reconnecting');
        this.scheduleRetry();
      }
    };

    ws.onerror = () => {
      let host = '(unknown)';
      try {
        host = new URL(url).host;
      } catch {
        /* ignore */
      }
      console.error(
        '[ws-provider] WebSocket error — code 1006 usually means the HTTP upgrade failed ' +
          '(wrong host/port, invalid session, or server unreachable). Target:',
        host,
      );
      // onclose will fire immediately after; retry is handled there
    };

    ws.onmessage = (event) => {
      this.handleMessage(event);
    };
  }

  // ── Message handling ────────────────────────────────────────────────────────

  private handleMessage(event: MessageEvent): void {
    // Binary frame → Yjs update delta
    if (event.data instanceof ArrayBuffer) {
      const update = new Uint8Array(event.data);
      Y.applyUpdate(ydoc, update, 'remote');
      return;
    }

    // Text frame → JSON control message
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data as string) as ServerMessage;
    } catch {
      console.warn('[ws-provider] Non-JSON text frame, ignoring');
      return;
    }

    switch (msg.type) {
      case 'init': {
        // Server is about to send the full binary state; record the seq
        this.storedLastSeq = msg.seq;
        this.initialised = true;
        // The next frame will be a binary blob — handled by the ArrayBuffer branch above
        break;
      }

      case 'synced': {
        // Reconnect diff replay complete; server confirms the current seq
        this.storedLastSeq = msg.seq;
        useWsStore.getState().setStatus('connected');
        break;
      }

      case 'awareness': {
        const update = new Uint8Array(msg.data);
        awarenessProtocol.applyAwarenessUpdate(awareness, update, 'remote');
        break;
      }

      case 'rejected': {
        console.warn('[ws-provider] Update rejected by server:', msg.reason, msg.nodeId);
        // Surface the rejection to the UI layer so it can render a toast and
        // (eventually) revert the local optimistic update for msg.nodeId.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('ligma:rejected', {
              detail: { reason: msg.reason, nodeId: msg.nodeId },
            }),
          );
        }
        break;
      }

      default: {
        console.warn('[ws-provider] Unknown server message:', msg);
      }
    }
  }

  // ── Reconnect sync request ──────────────────────────────────────────────────

  /**
   * Sends the reconnect handshake so the server can compute a minimal diff.
   * Uses the Yjs state vector (not just a seq number) for precision.
   */
  private sendSyncRequest(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const stateVector = Y.encodeStateVector(ydoc);
    this.ws.send(JSON.stringify({
      type: 'sync',
      lastSeq: this.storedLastSeq,
      stateVector: Array.from(stateVector),
    }));
  }

  // ── Exponential backoff ─────────────────────────────────────────────────────

  private scheduleRetry(): void {
    if (this.destroyed) return;
    this.clearRetryTimer();

    const delay = BACKOFF_DELAYS[Math.min(this.retryCount, BACKOFF_DELAYS.length - 1)]!;
    console.log(`[ws-provider] Reconnecting in ${delay}ms (attempt ${this.retryCount + 1})`);

    this.retryTimer = setTimeout(() => {
      this.retryCount++;
      this.openSocket();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

/**
 * Global provider instance. Call wsProvider.connect(roomId, token) once
 * the user has authenticated and entered a room. Call wsProvider.destroy()
 * on unmount / logout.
 */
export const wsProvider = new WsProvider();

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * Mount this hook in the room page component.
 * It handles connect on mount and destroy on unmount automatically.
 *
 * @example
 *   useWsProvider(roomId, sessionToken);
 */
export function useWsProvider(roomId: string, token: string | null): void {
  useEffect(() => {
    if (!roomId || !token) return;
    wsProvider.connect(roomId, token);
    return () => wsProvider.destroy();
  }, [roomId, token]);
}
