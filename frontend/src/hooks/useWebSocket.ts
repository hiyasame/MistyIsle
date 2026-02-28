import { useEffect, useRef, useCallback, useState } from 'react';
import { WS_BASE_URL } from '../utils/config';

interface WebSocketOptions {
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectDelay?: number;
}

/**
 * WebSocket Hook
 * @param roomId - 房间ID（用户级通知可以用 user_${userId}）
 * @param onMessage - 消息回调
 * @param options - 配置选项
 */
export function useWebSocket(
  roomId: string,
  onMessage: (data: any) => void,
  options: WebSocketOptions = {}
) {
  const {
    autoReconnect = true,
    reconnectInterval = 3000,
    maxReconnectDelay = 30000
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelayRef = useRef(reconnectInterval);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(() => {
    if (!roomId) return;

    try {
      const ws = new WebSocket(`${WS_BASE_URL}/ws/${roomId}`);

      ws.onopen = () => {
        console.log(`WebSocket connected to room: ${roomId}`);
        setIsConnected(true);
        setError(null);
        reconnectDelayRef.current = reconnectInterval; // 重置延迟
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage(data);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = () => {
        console.error('WebSocket error');
        setError('WebSocket connection error');
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        wsRef.current = null;

        // 自动重连
        if (autoReconnect) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`Reconnecting in ${reconnectDelayRef.current}ms...`);
            connect();
            // 指数退避，但不超过最大延迟
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * 2,
              maxReconnectDelay
            );
          }, reconnectDelayRef.current);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      setError('Failed to create WebSocket');
    }
  }, [roomId, onMessage, autoReconnect, reconnectInterval, maxReconnectDelay]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const send = useCallback((data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket is not connected');
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    error,
    send,
    disconnect,
    reconnect: connect
  };
}
