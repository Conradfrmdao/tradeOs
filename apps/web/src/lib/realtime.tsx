'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeMessage } from '@tradeos/shared';
import { API_URL } from './api';

/**
 * Live dashboard feed.
 *
 * Reconnects with exponential backoff, and reports its own state so the UI can
 * say "reconnecting" instead of quietly showing numbers that stopped updating
 * — on a trading dashboard, stale data that looks live is the dangerous case.
 */

export type ConnectionState = 'connecting' | 'open' | 'closed';

/**
 * How live updates reach the dashboard.
 *
 * A WebSocket needs a server process that stays alive, which a serverless
 * deployment does not have. Rather than hard-coding a build-time flag that can
 * silently disagree with the API, the API reports its own mode from /health and
 * the dashboard follows it.
 */
export type RealtimeMode = 'websocket' | 'poll';

let cachedMode: RealtimeMode | null = null;

async function detectMode(): Promise<RealtimeMode> {
  if (cachedMode) return cachedMode;

  try {
    const res = await fetch(`${API_URL}/health`, { credentials: 'omit' });
    const body = (await res.json()) as { realtime?: RealtimeMode };
    cachedMode = body.realtime === 'poll' ? 'poll' : 'websocket';
  } catch {
    // If the probe fails, assume the cheaper option: polling works everywhere,
    // a WebSocket does not.
    cachedMode = 'poll';
  }

  return cachedMode;
}

export function useRealtime(
  onMessage: (message: RealtimeMessage) => void,
  onPollTick?: () => void,
) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;
  const pollRef = useRef(onPollTick);
  pollRef.current = onPollTick;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;
    let disposed = false;

    // Polling replaces the socket entirely: refetch the REST snapshot on a
    // timer and report "open" so the UI does not claim to be offline.
    const startPolling = (intervalMs: number) => {
      if (disposed) return;
      setState('open');
      pollRef.current?.();
      poll = setInterval(() => pollRef.current?.(), intervalMs);
    };

    const connect = () => {
      if (disposed) return;

      const url = API_URL.replace(/^http/, 'ws') + '/ws';
      setState('connecting');

      try {
        socket = new WebSocket(url);
      } catch {
        scheduleRetry();
        return;
      }

      socket.onopen = () => {
        attempt = 0;
        setState('open');
      };

      socket.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(event.data as string) as RealtimeMessage);
        } catch {
          // A malformed frame is not worth tearing the connection down for.
        }
      };

      socket.onclose = () => {
        setState('closed');
        scheduleRetry();
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    const scheduleRetry = () => {
      if (disposed) return;
      // 1s, 2s, 4s… capped at 15s so a long outage does not hammer the server
      // but recovery is still prompt once it returns.
      const delay = Math.min(1000 * 2 ** attempt, 15_000);
      attempt++;
      retry = setTimeout(connect, delay);
    };

    void detectMode().then((mode) => {
      if (disposed) return;
      // 4s beats the agents' 3s poll, so the dashboard never sits a full
      // agent cycle behind what the API already knows.
      if (mode === 'poll') startPolling(4000);
      else connect();
    });

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      if (poll) clearInterval(poll);
      socket?.close();
    };
  }, []);

  return state;
}
