import { useEffect, useRef, useState, useCallback } from 'react';
import { WS_BASE_URL } from '../utils/config';
import {RoomMessage} from "../types";

interface WebSocketOptions {
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

/**
 * 房间 WebSocket Hook
 * 用于房间内的实时通信（同步播放、用户进出、直播状态等）
 */
export function useRoomWebSocket(
  roomId: string,
  onMessage: (message: RoomMessage) => void,
  options: WebSocketOptions = {}
) {
  const {
    autoReconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const isDisconnectingRef = useRef(false); // 标记正在主动断开
  const onMessageRef = useRef(onMessage);

  // 更新 onMessage ref
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // 发送消息
  const sendMessage = useCallback((action: string, data?: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const message = {
        room_id: roomId,
        action,
        data
      };
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    console.warn('WebSocket not connected, cannot send message');
    return false;
  }, [roomId]);

  // 连接 WebSocket
  const connect = useCallback(() => {
    if (!roomId || !mountedRef.current || isDisconnectingRef.current) return;

    try {
      // 清理旧连接
      if (wsRef.current) {
        const oldWs = wsRef.current;
        wsRef.current = null;
        oldWs.close();
      }

      const token = localStorage.getItem('auth_token') || '';
      const ws = new WebSocket(`${WS_BASE_URL}/ws/${roomId}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current || isDisconnectingRef.current) {
          ws.close(1000, 'Stale connection');
          return;
        }
        console.log(`WebSocket connected to room ${roomId}`);
        setIsConnected(true);
        setError(null);
        reconnectCountRef.current = 0;
        onMessageRef.current?.({ action: 'connected', data: {} });
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket message:', data);
          onMessageRef.current?.(data);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = () => {
        console.error('WebSocket error');
        setError('WebSocket connection error');
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed, code:', event.code, 'reason:', event.reason);

        // 忽略已被替换的旧连接的 close 事件
        if (wsRef.current !== ws) return;

        wsRef.current = null;
        setIsConnected(false);

        // unmount 或主动断开时不重连
        if (!mountedRef.current || isDisconnectingRef.current) return;

        if (autoReconnect && reconnectCountRef.current < maxReconnectAttempts) {
          reconnectCountRef.current += 1;
          console.log(`Reconnecting... (${reconnectCountRef.current}/${maxReconnectAttempts})`);
          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        } else if (reconnectCountRef.current >= maxReconnectAttempts) {
          setError('Max reconnect attempts reached');
        }
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [roomId, autoReconnect, reconnectInterval, maxReconnectAttempts]);

  // 断开连接
  const disconnect = useCallback(() => {
    isDisconnectingRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        ws.close(1000, 'User left room');
      } catch (e) {
        console.error('Error closing WebSocket:', e);
      }
    }
    setIsConnected(false);
  }, []);

  // 初始化和清理
  useEffect(() => {
    mountedRef.current = true;
    isDisconnectingRef.current = false;
    connect();

    return () => {
      mountedRef.current = false;
      isDisconnectingRef.current = true;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      const ws = wsRef.current;
      wsRef.current = null; // 先清空，让 onclose 里的 wsRef !== ws 检查生效
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'Component unmounted');
          } else if (ws.readyState === WebSocket.CONNECTING) {
            // 不在 CONNECTING 状态直接 close（会产生浏览器警告）
            // onopen 里会检查 isDisconnectingRef 并自行关闭
          }
        } catch (e) {
          console.error('Error closing WebSocket in cleanup:', e);
        }
      }

      setIsConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  return {
    isConnected,
    error,
    sendMessage,
    reconnect: connect,
    disconnect
  };
}
