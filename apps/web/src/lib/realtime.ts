'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';
import { useAuth } from './auth/auth-provider';

/** The API's Socket.IO endpoint: same origin as the API, path under the API prefix (DECISIONS D-041). */
function socketTarget(namespace: string): { url: string; path: string } {
  const api = new URL(API_URL);
  return { url: `${api.origin}${namespace}`, path: `${api.pathname.replace(/\/$/, '')}/socket.io` };
}

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * A Socket.IO connection to one namespace while signed in. The token is read at every (re)connect, so renewed tokens
 * are picked up; when the server drops the socket at token expiry, it reconnects with the fresh one. Handlers may
 * change between renders without reconnecting.
 */
export function useLiveSocket(
  namespace: '/notifications' | '/live-monitor',
  handlers: Record<string, (payload: never) => void>,
  enabled = true,
): LiveStatus {
  const { status, currentAccessToken } = useAuth();
  const [live, setLive] = useState<LiveStatus>('connecting');
  const handlersRef = useRef(handlers);
  const tokenRef = useRef(currentAccessToken);
  useEffect(() => {
    handlersRef.current = handlers;
    tokenRef.current = currentAccessToken;
  });

  useEffect(() => {
    if (!enabled || status !== 'authenticated') return;
    const { url, path } = socketTarget(namespace);
    const socket: Socket = io(url, {
      path,
      auth: (cb) => cb({ token: tokenRef.current() }),
      reconnectionDelayMax: 10_000,
    });
    socket.on('connect', () => setLive('live'));
    socket.on('connect_error', () => setLive('offline'));
    socket.on('disconnect', (reason) => {
      setLive('offline');
      // The server closes sockets when the access token expires; the session has renewed it by then.
      if (reason === 'io server disconnect') setTimeout(() => socket.connect(), 1_000);
    });
    socket.onAny((event: string, payload: unknown) =>
      (handlersRef.current[event] as ((p: unknown) => void) | undefined)?.(payload),
    );
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [namespace, enabled, status]);

  return enabled ? live : 'offline';
}
