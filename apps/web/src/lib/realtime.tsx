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

export function useRealtime(onMessage: (message: RealtimeMessage) => void) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

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

    connect();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, []);

  return state;
}
