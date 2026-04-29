'use client';

import { useEffect } from 'react';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { ydoc } from './yjs';
import { clearNodes } from './nodes';
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
  | { type: 'replay'; baseState?: string; updates: string[]; finalSeq: number }
  | { type: 'awareness'; data: number[] }
  | { type: 'rejected'; reason: string; nodeId?: string };

/** Pace replay so total visual duration is bounded — short for many, longer for a handful. */
function replayInterval(total: number): number {
  if (total > 40) return 110;
  if (total > 20) return 180;
  if (total > 10) return 260;
  return 360;
}

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
  /** Pending flag: push our local state to server after the next binary frame */
  private pendingStatePush = false;

  // Replay animation state (used when the server sends a replay envelope)
  private replayQueue: Uint8Array[] = [];
  private replayTimer: ReturnType<typeof setTimeout> | null = null;
  private replayFinalSeq = 0;
  /** Buffer for live updates received while a replay is animating */
  private liveUpdateBuffer: Uint8Array[] = [];

  constructor() {
    // ── Register Yjs + awareness listeners ONCE (not per reconnect) ──────────
    // Outgoing Yjs updates
    ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(update);
      }
    });

    // Outgoing awareness updates — only forward LOCAL changes. If we forwarded
    // remote updates back to the server, every awareness message would echo
    // around the room indefinitely.
    awareness.on(
      'update',
      (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        if (origin === 'remote') return;
        const changedClients = [...changes.added, ...changes.updated, ...changes.removed];
        if (changedClients.length === 0) return;
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
    if (this.roomId && this.roomId !== roomId) {
      clearNodes();
      this.initialised = false;
      this.pendingStatePush = false;
      this.cancelReplay();
    }
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
    this.cancelReplay();
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

    this.cancelReplay();
    this.detachSocket();

    const base = getWsBaseUrl();
    const q = encodeURIComponent(this.token);
    // If we have a stored seq (from any prior session OR an active reconnect),
    // pass it so the server sends a step-by-step replay envelope instead of an
    // instant full-state snap. The envelope includes a `baseState` so even an
    // empty client ydoc (page refresh) catches up before the animation runs.
    const seq = this.storedLastSeq;
    const url = seq > 0
      ? `${base}/ws/${this.roomId}?token=${q}&lastSeq=${seq}`
      : `${base}/ws/${this.roomId}?token=${q}`;
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

      // If we passed ?lastSeq=N on the URL the server is waiting for sync —
      // ask it for the replay envelope. Otherwise it's a fresh first connect
      // and the server is already sending init + full state automatically.
      if (this.storedLastSeq > 0) {
        this.sendSyncRequest();
      }

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
      console.debug(
        '[ws-provider] WebSocket error (code 1006 expected on disconnect). Target:',
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
      // If we are currently replaying missed history, buffer live updates
      // so they don't 'snap' the canvas to the future before the replay
      // animation can finish.
      if (useWsStore.getState().replay.active) {
        this.liveUpdateBuffer.push(update);
      } else {
        Y.applyUpdate(ydoc, update, 'remote');
      }
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
        // Server is about to send the full binary state; record the seq.
        // Only queue a state push if this is a fresh connect (not a reconnect
        // that already pushed via sendSyncRequest).
        const wasInitialised = this.initialised;
        this.storedLastSeq = msg.seq;
        this.initialised = true;
        if (!wasInitialised) {
          this.pendingStatePush = true;
        }
        break;
      }

      case 'synced': {
        // Reconnect diff replay complete; server confirms the current seq
        this.storedLastSeq = msg.seq;
        useWsStore.getState().setStatus('connected');
        break;
      }

      case 'replay': {
        // Server sent a step-by-step replay envelope for offline catchup.
        // baseState (if present) brings the local ydoc to the state at our
        // lastSeq instantly — needed for tab refreshes where ydoc starts empty.
        // Then each missed Yjs update is applied with a small delay so the
        // canvas evolves visibly instead of snapping to the latest state.
        this.startReplay(msg.baseState, msg.updates, msg.finalSeq);
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

  // ── Canvas replay (offline catchup) ─────────────────────────────────────────

  private startReplay(baseStateB64: string | undefined, updatesB64: string[], finalSeq: number): void {
    this.cancelReplay();

    // 1. Apply the base state (state at lastSeq) instantly so a fresh ydoc
    //    has the pre-disconnect snapshot to animate on top of. Yjs is
    //    idempotent, so this is a no-op for live reconnects already in sync.
    if (baseStateB64) {
      try {
        const bin = atob(baseStateB64);
        if (bin.length > 0) {
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          Y.applyUpdate(ydoc, arr, 'remote');
        }
      } catch (err) {
        console.warn('[ws-provider] Replay base state apply failed:', err);
      }
    }

    // 2. Decode the per-update replay queue.
    const decoded: Uint8Array[] = [];
    for (const b64 of updatesB64) {
      try {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        decoded.push(arr);
      } catch (err) {
        console.warn('[ws-provider] Skipping malformed replay update:', err);
      }
    }

    useWsStore.getState().setStatus('connected');

    if (decoded.length === 0) {
      // Nothing to animate — base state already brought us up to date.
      this.storedLastSeq = finalSeq;
      return;
    }

    this.replayQueue = decoded;
    this.replayFinalSeq = finalSeq;
    useWsStore.getState().setReplay({
      active: true,
      total: decoded.length,
      done: 0,
    });
    this.scheduleReplayTick();
  }

  private scheduleReplayTick(): void {
    if (this.replayTimer !== null) return;
    if (this.replayQueue.length === 0) {
      this.finishReplay();
      return;
    }
    const total = useWsStore.getState().replay.total;
    const delay = replayInterval(total);
    this.replayTimer = setTimeout(() => {
      this.replayTimer = null;
      const next = this.replayQueue.shift();
      if (!next) {
        this.finishReplay();
        return;
      }
      try {
        Y.applyUpdate(ydoc, next, 'remote');
      } catch (err) {
        console.warn('[ws-provider] Replay update apply failed:', err);
      }
      const state = useWsStore.getState().replay;
      useWsStore.getState().setReplay({
        active: this.replayQueue.length > 0,
        total: state.total,
        done: state.done + 1,
      });
      if (this.replayQueue.length > 0) {
        this.scheduleReplayTick();
      } else {
        this.finishReplay();
      }
    }, delay);
  }

  private finishReplay(): void {
    if (this.replayFinalSeq > 0) {
      this.storedLastSeq = this.replayFinalSeq;
      this.replayFinalSeq = 0;
    }
    useWsStore.getState().setReplay({ active: false, total: 0, done: 0 });
    // Replay finished — apply all live updates that happened while we were animating
    this.flushLiveBuffer();
  }

  private cancelReplay(): void {
    if (this.replayTimer !== null) {
      clearTimeout(this.replayTimer);
      this.replayTimer = null;
    }
    this.replayQueue = [];
    this.replayFinalSeq = 0;
    if (useWsStore.getState().replay.active) {
      useWsStore.getState().setReplay({ active: false, total: 0, done: 0 });
    }
    // Flush buffered live updates immediately if replay is cancelled
    this.flushLiveBuffer();
  }

  private flushLiveBuffer(): void {
    const updates = this.liveUpdateBuffer;
    this.liveUpdateBuffer = [];
    for (const u of updates) {
      try {
        Y.applyUpdate(ydoc, u, 'remote');
      } catch (err) {
        console.warn('[ws-provider] Failed to apply buffered live update:', err);
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

    // Also push our local state so server can recover any nodes it lost.
    const clientState = Y.encodeStateAsUpdate(ydoc);
    if (clientState.byteLength > 2) {
      this.ws.send(clientState);
    }
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
