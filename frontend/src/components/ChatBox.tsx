import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
  KeyboardEvent,
} from 'react';
import { roomApi } from '../services/api';
import type { ChatMessage, RoomUser } from '../types';
import UserCard from './UserCard';

interface ChatBoxProps {
  roomId: string;
  users: RoomUser[];
  currentUserId: string;
  hostId: string;
  sendMessage: (action: string, data: unknown) => boolean;
}

export interface ChatBoxHandle {
  receiveMessage: (msg: ChatMessage) => void;
}

// 格式化时间戳
function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (isToday) return `今天 ${hh}:${mm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

// 渲染含 @mention 高亮的文字内容
function renderContent(content: string, mentions: string[] | undefined, users: RoomUser[]) {
  if (!content) return null;
  if (!mentions || mentions.length === 0) return <span>{content}</span>;

  // 找出 @username 对应的高亮
  const mentionedUsernames = users
    .filter(u => mentions.includes(u.user_id))
    .map(u => u.username);

  if (mentionedUsernames.length === 0) return <span>{content}</span>;

  const pattern = new RegExp(
    `(@(?:${mentionedUsernames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`,
    'g'
  );

  const parts = content.split(pattern);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('@') && mentionedUsernames.includes(part.slice(1))) {
          return (
            <span key={i} style={{
              backgroundColor: 'rgba(71, 82, 196, 0.3)',
              color: '#dee0fc',
              borderRadius: '3px',
              padding: '0 2px'
            }}>
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

const ChatBox = forwardRef<ChatBoxHandle, ChatBoxProps>(
  ({ roomId, users, currentUserId, hostId, sendMessage }, ref) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
    const [uploading, setUploading] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionIndex, setMentionIndex] = useState(0);
    const [showMention, setShowMention] = useState(false);
    const [hoveredUser, setHoveredUser] = useState<RoomUser | null>(null);
    const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });

    const listRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const atCursorPos = useRef(0);
    const isAtBottom = useRef(true);

    // 加载历史消息
    useEffect(() => {
      roomApi.getChatHistory(roomId).then(res => {
        if (res.code === 0 && res.data.messages) {
          setMessages(res.data.messages);
        }
      }).catch(() => {/* ignore */});
    }, [roomId]);

    // 暴露给父组件的接收消息方法
    useImperativeHandle(ref, () => ({
      receiveMessage(msg: ChatMessage) {
        setMessages(prev => {
          // 去重
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    }));

    // 自动滚动到底部
    useEffect(() => {
      const el = listRef.current;
      if (!el) return;
      if (isAtBottom.current) {
        el.scrollTop = el.scrollHeight;
      }
    }, [messages]);

    const handleScroll = useCallback(() => {
      const el = listRef.current;
      if (!el) return;
      isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    }, []);

    // 过滤 @提及候选用户
    const mentionCandidates = showMention
      ? users.filter(
          u =>
            u.user_id !== currentUserId &&
            u.username.toLowerCase().includes(mentionQuery.toLowerCase())
        )
      : [];

    const insertMention = useCallback(
      (user: RoomUser) => {
        const text = inputText;
        const pos = atCursorPos.current;
        // 替换从 @ 到当前 query 末尾的文字
        const before = text.slice(0, pos);
        const after = text.slice(pos + mentionQuery.length);
        const newText = before + user.username + ' ' + after;
        setInputText(newText);
        setShowMention(false);
        setMentionQuery('');
        setTimeout(() => inputRef.current?.focus(), 0);
      },
      [inputText, mentionQuery]
    );

    const handleInput = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setInputText(val);

        const cursor = e.target.selectionStart ?? val.length;
        // 检查 @ 提及
        const textBeforeCursor = val.slice(0, cursor);
        const atMatch = textBeforeCursor.match(/@(\w*)$/);
        if (atMatch) {
          atCursorPos.current = cursor - atMatch[1].length; // @ 之后的起始位置
          setMentionQuery(atMatch[1]);
          setShowMention(true);
          setMentionIndex(0);
        } else {
          setShowMention(false);
          setMentionQuery('');
        }
      },
      []
    );

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (showMention && mentionCandidates.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setMentionIndex(i => Math.min(i + 1, mentionCandidates.length - 1));
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setMentionIndex(i => Math.max(i - 1, 0));
            return;
          }
          if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            insertMention(mentionCandidates[mentionIndex]);
            return;
          }
          if (e.key === 'Escape') {
            setShowMention(false);
            return;
          }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [showMention, mentionCandidates, mentionIndex, insertMention]
    );

    const handleSend = useCallback(() => {
      const text = inputText.trim();
      if (!text) return;

      // 解析 @提及的用户 ID
      const mentionedIds: string[] = [];
      users.forEach(u => {
        if (text.includes(`@${u.username}`)) {
          mentionedIds.push(u.user_id);
        }
      });

      sendMessage('chat', {
        content: text,
        image_url: '',
        reply_to_id: replyTo ? parseInt(replyTo.id) : undefined,
        mentions: mentionedIds,
      });

      setInputText('');
      setReplyTo(null);
      setShowMention(false);
    }, [inputText, users, sendMessage, replyTo]);

    const handleImageUpload = useCallback(
      async (file: File) => {
        if (uploading) return;
        setUploading(true);
        try {
          const res = await roomApi.uploadChatImage(roomId, file);
          if (res.code === 0 && res.data.url) {
            const mentionedIds: string[] = [];
            const text = inputText.trim();
            users.forEach(u => {
              if (text.includes(`@${u.username}`)) mentionedIds.push(u.user_id);
            });

            sendMessage('chat', {
              content: inputText.trim(),
              image_url: res.data.url,
              reply_to_id: replyTo ? parseInt(replyTo.id) : undefined,
              mentions: mentionedIds,
            });
            setInputText('');
            setReplyTo(null);
          }
        } catch (err) {
          console.error('Image upload failed:', err);
        } finally {
          setUploading(false);
          if (fileRef.current) fileRef.current.value = '';
        }
      },
      [uploading, roomId, inputText, users, sendMessage, replyTo]
    );

    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#2f3136',
        position: 'relative',
      }}>
        {/* 标题 */}
        <div style={{
          padding: '10px 16px',
          borderBottom: '1px solid #202225',
          fontSize: '0.75rem',
          fontWeight: '700',
          color: '#96989d',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          flexShrink: 0,
        }}>
          聊天
        </div>

        {/* 消息列表 */}
        <div
          ref={listRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 0',
          }}
        >
          {messages.length === 0 && (
            <div style={{
              textAlign: 'center',
              color: '#4f5660',
              fontSize: '0.875rem',
              padding: '2rem 1rem',
            }}>
              还没有消息，来打个招呼吧~
            </div>
          )}
          {messages.map(msg => (
            <MessageItem
              key={msg.id}
              msg={msg}
              currentUserId={currentUserId}
              hostId={hostId}
              users={users}
              onReply={setReplyTo}
              onUserHover={(user, pos) => { setHoveredUser(user); setHoverPosition(pos); }}
            />
          ))}
        </div>

        {/* 回复状态条 */}
        {replyTo && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            backgroundColor: '#2b2d31',
            borderLeft: '3px solid #4752c4',
            margin: '0 8px',
            borderRadius: '0 4px 4px 0',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: '0.75rem', color: '#b9bbbe', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              回复 <strong style={{ color: '#dee0fc' }}>{replyTo.username}</strong>：{replyTo.content || '[图片]'}
            </span>
            <button
              onClick={() => setReplyTo(null)}
              style={{
                background: 'none', border: 'none', color: '#96989d',
                cursor: 'pointer', fontSize: '1rem', padding: '0 4px', flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* @提及弹出菜单 */}
        {showMention && mentionCandidates.length > 0 && (
          <div style={{
            position: 'absolute',
            bottom: replyTo ? '110px' : '72px',
            left: '8px',
            right: '8px',
            backgroundColor: '#18191c',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 100,
            overflow: 'hidden',
            maxHeight: '200px',
            overflowY: 'auto',
          }}>
            {mentionCandidates.map((u, i) => (
              <div
                key={u.user_id}
                onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  backgroundColor: i === mentionIndex ? '#4752c4' : 'transparent',
                  color: i === mentionIndex ? '#fff' : '#dcddde',
                }}
                onMouseEnter={() => setMentionIndex(i)}
              >
                <div style={{
                  width: '24px', height: '24px', borderRadius: '50%',
                  backgroundColor: u.avatar ? 'transparent' : '#5865f2',
                  overflow: 'hidden', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '0.75rem', fontWeight: '700',
                  flexShrink: 0,
                }}>
                  {u.avatar
                    ? <img src={u.avatar} alt={u.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : u.username.charAt(0).toUpperCase()
                  }
                </div>
                <span style={{ fontSize: '0.875rem', fontWeight: '600' }}>{u.username}</span>
                {u.is_host && <span style={{ fontSize: '0.75rem', color: '#faa81a' }}>👑</span>}
              </div>
            ))}
          </div>
        )}

        {/* 输入区 */}
        <div style={{ padding: '8px', flexShrink: 0 }}>
          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '6px',
            backgroundColor: '#40444b',
            borderRadius: '8px',
            padding: '8px',
          }}>
            {/* 图片上传按钮 */}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="上传图片"
              style={{
                background: 'none', border: 'none',
                color: uploading ? '#4f5660' : '#b9bbbe',
                cursor: uploading ? 'not-allowed' : 'pointer',
                padding: '2px 4px', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'color 0.15s',
                outline: 'none',
              }}
              onMouseEnter={(e) => { if (!uploading) e.currentTarget.style.color = '#dcddde'; }}
              onMouseLeave={(e) => { if (!uploading) e.currentTarget.style.color = '#b9bbbe'; }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.00098C6.486 2.00098 2 6.48698 2 12.001C2 17.515 6.486 22.001 12 22.001C17.514 22.001 22 17.515 22 12.001C22 6.48698 17.514 2.00098 12 2.00098ZM17 13.001H13V17.001H11V13.001H7V11.001H11V7.00098H13V11.001H17V13.001Z" />
              </svg>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(file);
              }}
            />

            {/* 文字输入框 */}
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="发送消息…"
              rows={1}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                boxShadow: 'none',
                color: '#dcddde',
                fontSize: '0.9375rem',
                resize: 'none',
                lineHeight: '1.5',
                maxHeight: '120px',
                overflowY: 'auto',
                fontFamily: 'inherit',
                WebkitAppearance: 'none',
              }}
            />

            {/* 发送按钮 */}
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              title="发送 (Enter)"
              style={{
                background: 'none', border: 'none',
                color: inputText.trim() ? '#5865f2' : '#4f5660',
                cursor: inputText.trim() ? 'pointer' : 'default',
                fontSize: '1.125rem', padding: '2px 4px', flexShrink: 0,
                transition: 'color 0.15s',
              }}
            >
              ➤
            </button>
          </div>
        </div>

        {/* 用户信息悬停卡片 */}
        {hoveredUser && (
          <UserCard user={hoveredUser} position={hoverPosition} />
        )}
      </div>
    );
  }
);

ChatBox.displayName = 'ChatBox';
export default ChatBox;

// ─── 单条消息组件 ───────────────────────────────────────────────
interface MessageItemProps {
  msg: ChatMessage;
  currentUserId: string;
  hostId: string;
  users: RoomUser[];
  onReply: (msg: ChatMessage) => void;
  onUserHover: (user: RoomUser | null, pos: { x: number; y: number }) => void;
}

function MessageItem({ msg, hostId, users, onReply, onUserHover }: MessageItemProps) {
  const [hovered, setHovered] = useState(false);
  const isHost = msg.user_id === hostId;

  // 构造一个临时 RoomUser 用于悬停卡片
  const roomUser: RoomUser = {
    user_id: msg.user_id,
    username: msg.username,
    avatar: msg.avatar,
    bio: users.find(u => u.user_id === msg.user_id)?.bio,
    is_host: isHost,
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        gap: '10px',
        padding: '4px 12px',
        backgroundColor: hovered ? '#36393f' : 'transparent',
        position: 'relative',
        transition: 'background-color 0.1s',
      }}
    >
      {/* 头像 */}
      <div
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onUserHover(roomUser, { x: rect.left, y: rect.top + rect.height / 2 });
        }}
        onMouseLeave={() => onUserHover(null, { x: 0, y: 0 })}
        style={{
          width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
          backgroundColor: msg.avatar ? 'transparent' : '#5865f2',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.9rem', fontWeight: '700', color: 'white',
          overflow: 'hidden', marginTop: '2px', cursor: 'pointer',
        }}
      >
        {msg.avatar
          ? <img src={msg.avatar} alt={msg.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : msg.username?.charAt(0).toUpperCase() || '?'
        }
      </div>

      {/* 内容 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 用户名 + 时间 */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' }}>
          <span style={{
            fontSize: '0.9375rem', fontWeight: '600',
            color: isHost ? '#faa81a' : '#5865f2',
          }}>
            {msg.username}{isHost && ' 👑'}
          </span>
          <span style={{ fontSize: '0.75rem', color: '#72767d' }}>
            {formatTime(msg.created_at)}
          </span>
        </div>

        {/* 回复气泡 */}
        {msg.reply_to && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            borderLeft: '2px solid #4752c4',
            paddingLeft: '8px',
            marginBottom: '4px',
            color: '#96989d',
            fontSize: '0.8125rem',
          }}>
            <span style={{ color: '#dee0fc', fontWeight: '600' }}>{msg.reply_to.username}</span>
            <span style={{
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px',
            }}>
              {msg.reply_to.content || (msg.reply_to.image_url ? '[图片]' : '')}
            </span>
          </div>
        )}

        {/* 文字内容 */}
        {msg.content && (
          <div style={{
            fontSize: '0.9375rem', color: '#dcddde', lineHeight: '1.5',
            wordBreak: 'break-word', whiteSpace: 'pre-wrap',
          }}>
            {renderContent(msg.content, msg.mentions, users)}
          </div>
        )}

        {/* 图片 */}
        {msg.image_url && (
          <a href={msg.image_url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '4px' }}>
            <img
              src={msg.image_url}
              alt="图片"
              style={{
                maxWidth: '240px', maxHeight: '200px',
                borderRadius: '4px', display: 'block',
                cursor: 'pointer',
              }}
            />
          </a>
        )}
      </div>

      {/* hover 操作按钮 */}
      {hovered && (
        <div style={{
          position: 'absolute', right: '12px', top: '2px',
          display: 'flex', gap: '4px',
        }}>
          <button
            onClick={() => onReply(msg)}
            title="回复"
            style={{
              padding: '4px 8px',
              backgroundColor: '#40444b',
              border: 'none', borderRadius: '4px',
              color: '#b9bbbe', cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: '600',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#4752c4'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#40444b'}
          >
            ↩ 回复
          </button>
        </div>
      )}
    </div>
  );
}
