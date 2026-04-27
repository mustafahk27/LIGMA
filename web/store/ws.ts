import { create } from 'zustand';

export type WsStatus = 'connected' | 'reconnecting' | 'offline';

interface WsStore {
  /** Current WebSocket connection state (drives the coloured status dot in the UI) */
  status: WsStatus;
  /** Last event seq successfully received from the server */
  lastSeq: number;
  setStatus: (status: WsStatus) => void;
  setLastSeq: (seq: number) => void;
}

export const useWsStore = create<WsStore>((set) => ({
  status: 'offline',
  lastSeq: 0,
  setStatus: (status) => set({ status }),
  setLastSeq: (seq) => set({ lastSeq: seq }),
}));
