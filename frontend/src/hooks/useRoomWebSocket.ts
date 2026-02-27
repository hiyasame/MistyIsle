import { useEffect, useRef, useState, useCallback } from 'react';
import { WS_BASE_URL } from '../utils/config';

/**
 * 房间 WebSocket Hook
 * 用于房间内的实时通信（同步播放、用户进出、直播状态等）
 */
export function useRoomWebSocket(roomId, onMessage, options = {}) {
  const {
    autoReconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const isDisconnectingRef = useRef(false); // 标记正在主动断开
  const onMessageRef = useRef(onMessage);

  // 更新 onMessage ref
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // 发送消息
  const sendMessage = useCallback((action, data) => {
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
    if (!roomId || !mountedRef.current) return;

    try {
      // 清理旧连接（如果存在）
      if (wsRef.current) {
        const oldWs = wsRef.current;
        wsRef.current = null; // 先清空 ref，避免 onclose 触发重连
        oldWs.close(); // 再关闭连接
      }

      // 从 localStorage 获取 token，通过 URL 参数传递
      const token = localStorage.getItem('auth_token') || '';
      const ws = new WebSocket(`${WS_BASE_URL}/ws/${roomId}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`WebSocket connected to room ${roomId}`);
        setIsConnected(true);
        setError(null);
        reconnectCountRef.current = 0;

        // 通知应用层连接已建立
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

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('WebSocket connection error');
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed, code:', event.code, 'reason:', event.reason);
        setIsConnected(false);

        // 只有当 wsRef 仍指向当前关闭的 WebSocket 时才处理
        if (wsRef.current !== ws) {
          // WebSocket 已被替换（如重新连接时），忽略旧连接的 close 事件
          return;
        }

        wsRef.current = null;

        // 自动重连（除非正在主动断开）
        if (!isDisconnectingRef.current && autoReconnect && mountedRef.current && reconnectCountRef.current < maxReconnectAttempts) {
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
      setError(err.message);
    }
  }, [roomId, autoReconnect, reconnectInterval, maxReconnectAttempts]);

  // 断开连接
  const disconnect = useCallback(() => {
    isDisconnectingRef.current = true; // 标记正在主动断开，阻止自动重连

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'User left room');
      } catch (e) {
        console.error('Error closing WebSocket:', e);
      }
      wsRef.current = null;
    }
    setIsConnected(false);

    // 延迟重置标记，确保 onclose 回调已执行
    setTimeout(() => {
      isDisconnectingRef.current = false;
    }, 100);
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
      }

      // 获取当前的 WebSocket 引用
      const ws = wsRef.current;
      if (ws) {
        try {
          // 只有在连接存在且未关闭时才调用 close
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close(1000, 'Component unmounted');
          }
        } catch (e) {
          console.error('Error closing WebSocket in cleanup:', e);
        }
        // 在 cleanup 中不要设置 wsRef.current = null，让 onclose 处理
      }

      setIsConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]); // 只依赖 roomId，避免 connect/disconnect 变化导致重新连接

  return {
    isConnected,
    error,
    sendMessage,
    reconnect: connect,
    disconnect
  };
}
