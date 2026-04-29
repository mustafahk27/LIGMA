import { create } from 'zustand';

export type WsStatus = 'connected' | 'reconnecting' | 'offline';

export interface ReplayState {
  active: boolean;
  total: number;
  done: number;
}

interface WsStore {
  /** Current WebSocket connection state (drives the coloured status dot in the UI) */
  status: WsStatus;
  /** Last event seq successfully received from the server */
  lastSeq: number;
  /** Canvas-replay progress for an offline-catchup animation */
  replay: ReplayState;
  setStatus: (status: WsStatus) => void;
  setLastSeq: (seq: number) => void;
  setReplay: (replay: ReplayState) => void;
}

export const useWsStore = create<WsStore>((set) => ({
  status: 'offline',
  lastSeq: 0,
  replay: { active: false, total: 0, done: 0 },
  setStatus: (status) => set({ status }),
  setLastSeq: (seq) => set({ lastSeq: seq }),
  setReplay: (replay) => set({ replay }),
}));
