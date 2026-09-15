'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AccountDto, CopyEventDto, NotificationDto, PortfolioDto, RealtimeMessage } from '@tradeos/shared';
import { get, post } from './api';
import { useRealtime, type ConnectionState } from './realtime';

/**
 * Shared live state for the whole signed-in area.
 *
 * One WebSocket and one initial fetch serve every page, so navigating between
 * Dashboard, Accounts and Copier does not re-open a socket or re-request data
 * that is already streaming in.
 */

interface LiveData {
  accounts: AccountDto[];
  portfolio: PortfolioDto | null;
  events: CopyEventDto[];
  notifications: NotificationDto[];
  unreadCount: number;
  connection: ConnectionState;
  loading: boolean;
  reload: () => Promise<void>;
  markNotificationsRead: () => Promise<void>;
}

const LiveDataContext = createContext<LiveData | null>(null);

const MAX_EVENTS = 200;

export function LiveDataProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioDto | null>(null);
  const [events, setEvents] = useState<CopyEventDto[]>([]);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [accountData, portfolioData, eventData, notificationData] = await Promise.all([
        get<{ accounts: AccountDto[] }>('/accounts'),
        get<{ portfolio: PortfolioDto }>('/portfolio'),
        get<{ items: CopyEventDto[] }>('/copier/events?pageSize=50'),
        get<{ items: NotificationDto[]; unread: number }>('/notifications'),
      ]);

      setAccounts(accountData.accounts);
      setPortfolio(portfolioData.portfolio);
      setEvents(eventData.items);
      setNotifications(notificationData.items);
      setUnreadCount(notificationData.unread);
    } catch (err) {
      console.error('Failed to load dashboard data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onMessage = useCallback((message: RealtimeMessage) => {
    switch (message.type) {
      case 'accounts':
        setAccounts(message.data);
        break;
      case 'account':
        setAccounts((prev) => prev.map((a) => (a.id === message.data.id ? message.data : a)));
        break;
      case 'portfolio':
        setPortfolio(message.data);
        break;
      case 'copy.event':
        // Newest first, bounded — an active copier can emit events faster than
        // anyone reads them, and an unbounded list would grow without limit.
        setEvents((prev) => [message.data, ...prev].slice(0, MAX_EVENTS));
        break;
      case 'notification':
        setNotifications((prev) => [message.data, ...prev].slice(0, 50));
        setUnreadCount((prev) => prev + 1);
        break;
      default:
        break;
    }
  }, []);

  const connection = useRealtime(onMessage);

  // The socket delivers deltas, so a reconnect may have missed some. Refetch
  // the snapshot whenever the connection is re-established.
  const [wasOpen, setWasOpen] = useState(false);
  useEffect(() => {
    if (connection === 'open' && wasOpen) void reload();
    if (connection === 'open') setWasOpen(true);
  }, [connection, wasOpen, reload]);

  const markNotificationsRead = useCallback(async () => {
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    await post('/notifications/read', {}).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({
      accounts,
      portfolio,
      events,
      notifications,
      unreadCount,
      connection,
      loading,
      reload,
      markNotificationsRead,
    }),
    [accounts, portfolio, events, notifications, unreadCount, connection, loading, reload, markNotificationsRead],
  );

  return <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>;
}

export function useLiveData(): LiveData {
  const context = useContext(LiveDataContext);
  if (!context) throw new Error('useLiveData must be used inside LiveDataProvider');
  return context;
}
