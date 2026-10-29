'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Reply,
  X,
  AtSign,
  Info,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  ChatMessageList,
  ChatMessage,
  ChatMessageBubble,
  ChatSystemMessage,
  ChatComposer,
  ChatComposerDrawer,
} from '@astryxdesign/core/Chat';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { Item } from '@astryxdesign/core/Item';
import { UserAvatar } from '@/components/user-avatar';
import { SafeImage } from '@/components/safe-image';
import { MediaLightbox } from '@/components/media-lightbox';
import { ChatContextInspector } from '@/components/chat-context-inspector';
import { GroupInfoDrawer } from './group-info-drawer';
import { characterDetailHref } from '@/lib/character-routes';
import { Code2 } from 'lucide-react';
import { useAppToast } from '@/lib/toast';
import { useClientSync } from '@/components/client-sync-provider';
import {
  sendGroupMessage,
  toggleGroupReaction,
  markGroupAsRead,
} from '@/server/actions/groups';
import type { GroupMemberView, GroupMessageView } from '@/server/groups';
import type { aiCharacters, groups } from '@/db/schema';
import type { MediaAssetView } from '@/server/media';

type CharacterRow = typeof aiCharacters.$inferSelect;
type GroupRow = typeof groups.$inferSelect;

type PendingImage = {
  id: string;
  file: File;
  previewUrl: string;
  assetId?: string;
  blobUrl?: string;
  perception?: {
    status: string;
    summary: string | null;
    perception?: string | null;
    ocrText: string | null;
  } | null;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
};
import * as stylex from '@stylexjs/stylex';

const spin = stylex.keyframes({
  from: {transform: 'rotate(0deg)'},
  to: {transform: 'rotate(360deg)'},
});

const pokeShake = stylex.keyframes({
  '0%': { transform: 'rotate(0deg)' },
  '15%': { transform: 'rotate(-14deg)' },
  '30%': { transform: 'rotate(12deg)' },
  '45%': { transform: 'rotate(-10deg)' },
  '60%': { transform: 'rotate(8deg)' },
  '75%': { transform: 'rotate(-4deg)' },
  '90%': { transform: 'rotate(2deg)' },
  '100%': { transform: 'rotate(0deg)' },
});
const styles = stylex.create({
  root: {position: 'relative', display: 'flex', height: '100%', minHeight: 0, flexDirection: 'column', overflow: 'hidden'},
  header: {display: 'flex', height: '56px', flexShrink: 0, alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-background-surface)', paddingInline: '8px', '@media (min-width: 640px)': {paddingInline: '16px'}},
  backLink: {display: 'flex', width: '36px', height: '36px', flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: '9999px', color: 'var(--color-text-secondary)', transition: 'background-color 150ms ease', '@media (min-width: 1024px)': {display: 'none'}, ':hover': {backgroundColor: 'var(--color-background-muted)'}},
  headerInfo: {minWidth: 0, flex: 1, overflow: 'hidden'},
  headerTitle: {display: 'flex', alignItems: 'center', gap: '6px'},
  name: {overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '15px', fontWeight: 'var(--font-weight-semibold)', lineHeight: 1.1},
  memberCount: {borderRadius: '9999px', backgroundColor: 'var(--color-background-muted)', paddingInline: '6px', paddingBlock: '2px', fontSize: '11px', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text-secondary)'},
  scrollAreaWrapper: {position: 'relative', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden'},
  scroll: {minHeight: 0, flex: 1, overflowY: 'auto', overscrollBehavior: 'contain'},
  messages: {
    width: '100%',
    paddingTop: '16px',
    paddingInline: '16px',
    paddingBottom: stylex.firstThatWorks('50dvh', '50vh'),
    '@media (min-width: 640px)': {
      paddingInline: '24px',
    },
  },
  reply: {display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)'},
  replyText: {maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'},
  attachmentSingle: {maxWidth: '320px', marginBottom: '8px'},
  attachmentGrid: {display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', maxWidth: '360px', gap: '6px', marginBottom: '8px'},
  attachment: {position: 'relative', cursor: 'pointer', overflow: 'hidden', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-container)', backgroundColor: 'var(--color-background-surface)', transition: 'opacity 150ms ease, box-shadow 150ms ease', ':hover': {opacity: 0.95, boxShadow: 'var(--shadow-med)'}},
  image: {width: '100%', height: 'auto', maxHeight: '260px', objectFit: 'cover'},
  messageText: {whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'},
  reactionsUser: {display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '4px', marginTop: '4px'},
  reactions: {display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px'},
  reaction: {display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid var(--color-border)', borderRadius: '9999px', backgroundColor: 'var(--color-background-surface)', paddingInline: '8px', paddingBlock: '2px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', transition: 'all 150ms ease', ':hover': {backgroundColor: 'var(--color-background-muted)'}},
  reacted: {borderColor: 'var(--color-accent)', backgroundColor: 'var(--color-accent-muted)', color: 'var(--color-text-accent)'},
  reactionCount: {fontSize: '11px'},
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    pointerEvents: 'none',
    backgroundColor: 'transparent',
    paddingInline: '16px',
    paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
    paddingTop: '8px',
    '@media (min-width: 640px)': {
      paddingInline: '24px',
      paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
    },
  },
  gradientBackdrop: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
    height: '180px',
    pointerEvents: 'none',
    zIndex: 6,
    background: 'linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.3) 100%)',
    opacity: 0,
    transition: 'opacity 250ms ease',
  },
  gradientBackdropVisible: {
    opacity: 1,
  },
  composerFloating: {
    pointerEvents: 'auto',
    width: '100%',
  },
  composerWrap: {display: 'flex', width: '100%', flexDirection: 'column', gap: '8px'},
  composerBody: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--color-border)',
    boxShadow: 'none',
    backgroundColor: 'var(--color-background-body)',
    borderRadius: 'var(--radius-chat)',
  },
  replyBar: {display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-element)', backgroundColor: 'var(--color-background-surface)', paddingInline: '12px', paddingBlock: '6px', fontSize: 'var(--font-size-xs)'},
  replyBarInner: {display: 'flex', minWidth: 0, alignItems: 'center', gap: '6px', overflow: 'hidden'},
  smallSecondary: {color: 'var(--color-text-secondary)'},
  smallButton: {padding: '2px', color: 'var(--color-text-secondary)', ':hover': {color: 'var(--color-text-primary)'}},
  mentionBox: {
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-container)',
    backgroundColor: 'var(--color-background-surface)',
    padding: '6px',
    boxShadow: 'var(--shadow-med)',
  },
  mentionHeader: {display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', paddingInline: '6px', paddingBlock: '2px', fontSize: '11px', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text-secondary)'},
  mentionLabel: {display: 'flex', alignItems: 'center', gap: '4px'},
  mentionList: {display: 'flex', flexDirection: 'column', maxHeight: '200px', gap: '2px', overflowY: 'auto'},
  mentionItemWrap: {borderRadius: 'var(--radius-element)', overflow: 'hidden'},
  pendingRow: {display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', paddingBlock: '4px'},
  pendingItem: {position: 'relative', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-container)', backgroundColor: 'var(--color-background-surface)', padding: '6px 8px 6px 6px', fontSize: 'var(--font-size-xs)'},
  preview: {position: 'relative', display: 'flex', width: '48px', height: '48px', flexShrink: 0, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 'var(--radius-element)', backgroundColor: 'var(--color-background-muted)'},
  previewImage: {width: '100%', height: '100%', objectFit: 'cover'},
  overlayUploading: {position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.5)', color: '#fff'},
  overlayError: {position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-error)', color: 'var(--color-on-error)'},
  fileInfo: {maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'},
  fileName: {overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 'var(--font-weight-medium)'},
  fileStatus: {fontSize: '11px', color: 'var(--color-text-secondary)'},
  iconButton: {borderRadius: '9999px', padding: '4px', color: 'var(--color-text-secondary)', ':hover': {color: 'var(--color-text-primary)', backgroundColor: 'var(--color-background-muted)'}},
  removeButton: {borderRadius: '9999px', padding: '4px', color: 'var(--color-text-secondary)', ':hover': {color: 'var(--color-error)', backgroundColor: 'var(--color-background-muted)'}},
  hidden: {display: 'none'},
  footerActions: {display: 'flex', alignItems: 'center', gap: '6px'},
  spin: {animationName: spin, animationDuration: '1s', animationTimingFunction: 'linear', animationIterationCount: 'infinite'},
  avatarPokeWrap: {
    display: 'inline-flex',
    cursor: 'pointer',
    userSelect: 'none',
    transformOrigin: 'bottom center',
  },
  avatarProfileButton: {
    borderWidth: 0,
    padding: 0,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    borderRadius: 'var(--radius-full)',
    display: 'inline-flex',
    ':focus-visible': {
      outline: '2px solid',
      outlineColor: 'var(--color-accent)',
      outlineOffset: 2,
    },
  },
  avatarPoking: {
    animationName: pokeShake,
    animationDuration: '500ms',
    animationTimingFunction: 'ease-in-out',
  },
});
export function GroupChatWindow({
  group,
  members,
  allCharacters,
  user,
  initialMessages,
  isDevMode = false,
  isVisionEnabled = true,
}: {
  group: GroupRow;
  members: GroupMemberView[];
  allCharacters: CharacterRow[];
  user: { name: string; imageUrl: string | null };
  initialMessages: GroupMessageView[];
  isDevMode?: boolean;
  isVisionEnabled?: boolean;
}) {
  const toast = useAppToast();
  const router = useRouter();
  const { refresh: refreshSync } = useClientSync();
  const [isPending, startTransition] = useTransition();
  const [showDevInspector, setShowDevInspector] = useState(false);
  const [messages, setMessages] = useState<GroupMessageView[]>(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [replyingTo, setReplyingTo] = useState<GroupMessageView | null>(null);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [pokingMessageId, setPokingMessageId] = useState<string | null>(null);
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [activeLightboxMedia, setActiveLightboxMedia] = useState<{
    id?: string | null;
    url: string;
    originalFilename?: string | null;
    width?: number | null;
    height?: number | null;
    perception?: { summary?: string | null; ocrText?: string | null; status?: string } | null;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const stickToBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // 悬浮输入框实测高度（含安全区与上下内边距），用作消息列表的底部 padding
  const [composerHeight, setComposerHeight] = useState(0);

  // Sync initial messages when props change
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  // Mark group read on mount and when group changes
  useEffect(() => {
    markGroupAsRead(group.id).catch(console.error);
  }, [group.id]);

  // 停留在群聊底部时，新到达的消息一旦可见即标记已读（Telegram/QQ 逻辑）
  const lastSeenGroupMessageIdRef = useRef<string | null>(initialMessages.at(-1)?.id ?? null);
  useEffect(() => {
    if (!isAtBottom || document.visibilityState !== 'visible') return;
    const last = messages[messages.length - 1];
    if (!last || last.id === lastSeenGroupMessageIdRef.current) return;
    lastSeenGroupMessageIdRef.current = last.id;
    markGroupAsRead(group.id)
      .then(() => refreshSync())
      .catch(console.error);
  }, [isAtBottom, messages, group.id, refreshSync]);

  // 瞬时跳到最底部，用于进入群聊时直接查看最新消息
  const scrollToEndInstant = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    const prevBehavior = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollTop = el.scrollHeight;
    el.style.scrollBehavior = prevBehavior;
  }, []);

  // 消息列表底部 padding 始终与输入框区域等高：
  // ResizeObserver 跟踪悬浮输入框（含多行增长、附件抽屉、安全区）的实时高度，
  // 贴底时同步校正滚动位置，避免列表内容被输入框遮挡或留出多余空档
  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const update = () => {
      setComposerHeight(el.offsetHeight);
      if (stickToBottomRef.current) scrollToEndInstant();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollToEndInstant]);

  // 进入群聊后直接跳到最底部：初始渲染与图片加载会持续撑高内容，
  // 在帧内多次校正并用捕获监听图片 load 保持贴底
  useEffect(() => {
    stickToBottomRef.current = true;
    scrollToEndInstant();
    let cancelled = false;
    const retry = () => {
      if (!cancelled) scrollToEndInstant();
    };
    const rafIds = [requestAnimationFrame(retry), requestAnimationFrame(retry)];
    const timers = [100, 400].map((ms) => setTimeout(retry, ms));
    const el = scrollRef.current;
    const onLoadCapture = () => retry();
    el?.addEventListener('load', onLoadCapture, true);
    return () => {
      cancelled = true;
      rafIds.forEach((id) => cancelAnimationFrame(id));
      timers.forEach((id) => clearTimeout(id));
      el?.removeEventListener('load', onLoadCapture, true);
    };
  }, [group.id, scrollToEndInstant]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setIsAtBottom(true);
    } else if (el) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 10;
      setIsAtBottom(atBottom);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = remaining <= 10;
    stickToBottomRef.current = remaining < 80;
    setIsAtBottom(atBottom);
  };
  useEffect(() => {
    const handleResize = () => {
      const el = scrollRef.current;
      if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Real-time polling for group messages
  const lastGroupMsgCountRef = useRef(initialMessages.length);
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/groups/${group.id}/messages`);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && Array.isArray(data.messages)) {
            // 群消息有更新时同步刷新全局未读数与会话列表，避免侧栏列表延迟
            if (data.messages.length !== lastGroupMsgCountRef.current) {
              lastGroupMsgCountRef.current = data.messages.length;
              refreshSync();
            }
            setMessages(data.messages);
          }
        }
      } catch (err) {
        console.error('Failed to poll group messages', err);
      }
    }, 3500);

    return () => clearInterval(interval);
  }, [group.id, refreshSync]);

  // Image Upload helper
  const uploadImageFile = async (file: File) => {
    if (!isVisionEnabled) {
      toast.error('AI 识图功能未开启，无法发送图片');
      return;
    }
    const tempId = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);

    const newPending: PendingImage = {
      id: tempId,
      file,
      previewUrl,
      status: 'uploading',
    };

    setPendingImages((prev) => [...prev, newPending]);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', 'attachment');

      const res = await fetch('/api/media/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setPendingImages((prev) =>
          prev.map((item) =>
            item.id === tempId
              ? { ...item, status: 'error', error: data.error || '图片上传与解析失败' }
              : item,
          ),
        );
        toast.error(data.error || '图片上传与解析失败');
        return;
      }

      setPendingImages((prev) =>
        prev.map((item) =>
          item.id === tempId
            ? {
                ...item,
                status: 'ready',
                assetId: data.media.id,
                blobUrl: data.media.blobUrl,
                perception: data.media?.perception || data.perception || null,
              }
            : item,
        ),
      );
    } catch (err) {
      console.error('Failed to upload image', err);
      setPendingImages((prev) =>
        prev.map((item) =>
          item.id === tempId ? { ...item, status: 'error', error: '网络错误' } : item,
        ),
      );
      toast.error('网络错误，图片上传失败');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isVisionEnabled) return;
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    for (const file of files) {
      uploadImageFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const retryUpload = (img: PendingImage) => {
    setPendingImages((prev) => prev.filter((i) => i.id !== img.id));
    uploadImageFile(img.file);
  };

  const removePendingImage = (id: string) => {
    setPendingImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const isUploadingAny = pendingImages.some((i) => i.status === 'uploading');

  // Handle Send Message
  const handleSend = async (rawText?: string) => {
    const text = (rawText ?? inputValue).trim();
    if (isUploadingAny || isPending) return;

    const readyAttachments: MediaAssetView[] = isVisionEnabled
      ? pendingImages
          .filter((i) => i.status === 'ready' && i.assetId && i.blobUrl)
          .map((i) => ({
            id: i.assetId!,
            userId: '',
            mediaType: 'image' as const,
            blobUrl: i.blobUrl!,
            pathname: '',
            downloadUrl: null,
            mimeType: i.file.type || 'image/jpeg',
            fileSize: i.file.size,
            originalFilename: i.file.name,
            width: null,
            height: null,
            duration: null,
            status: 'ready' as const,
            purpose: 'attachment' as const,
            perception: i.perception ?? null,
            createdAt: new Date(),
          }))
      : [];

    const mediaAssetIds = readyAttachments.map((a) => a.id);

    if (!text && mediaAssetIds.length === 0) return;

    // Detect mentioned AI members in text
    const mentions: { type: 'ai'; id: string; name: string; username: string }[] = [];
    members.forEach((m) => {
      if (m.characterId && (text.includes(`@${m.name}`) || text.includes(`@${m.username}`))) {
        mentions.push({
          type: 'ai',
          id: m.characterId,
          name: m.name,
          username: m.username,
        });
      }
    });

    const replyId = replyingTo?.id;

    // Optimistic UI insert
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: GroupMessageView = {
      id: tempId,
      groupId: group.id,
      senderType: 'user',
      senderCharacterId: null,
      senderName: '我',
      senderUsername: 'me',
      senderAvatarEmoji: '👤',
      senderAvatarColor: 'violet',
      senderAvatarUrl: null,
      content: text || (mediaAssetIds.length > 0 ? '[图片]' : ''),
      attachments: readyAttachments,
      replyTo: replyingTo
        ? {
            id: replyingTo.id,
            senderName: replyingTo.senderName,
            content: replyingTo.content.slice(0, 60),
          }
        : null,
      mentions,
      reactions: [],
      createdAt: new Date(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setInputValue('');
    setReplyingTo(null);
    setShowMentionPicker(false);
    setPendingImages([]);
    stickToBottomRef.current = true;
    scrollToBottom();

    startTransition(async () => {
      try {
        await sendGroupMessage(group.id, {
          content: text,
          mediaAssetIds,
          replyToMessageId: replyId,
          mentions,
        });
      } catch (err) {
        console.error('Failed to send group message', err);
        toast.error('发送失败，请重试');
      }
    });
  };

  // Toggle Reaction
  const handleReaction = async (messageId: string, emoji: string) => {
    try {
      await toggleGroupReaction(group.id, messageId, emoji);
      const res = await fetch(`/api/groups/${group.id}/messages`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.messages)) {
          setMessages(data.messages);
        }
      }
    } catch (err) {
      console.error('Failed to toggle reaction', err);
    }
  };

  const aiMembers = members.filter((m) => m.memberType === 'ai');

  const insertMention = (member: GroupMemberView) => {
    setInputValue((prev) => {
      // If the user already typed a trailing '@', replace it with '@Member ' rather than appending '@@Member '
      const base = prev.endsWith('@') ? prev.slice(0, -1) : prev;
      return `${base}@${member.name} `;
    });
    setShowMentionPicker(false);
  };

  // 单击 AI 头像进入全屏资料页，双击仍是「拍一拍」：单击延迟触发，双击时取消
  const avatarTapTimer = useRef<number | null>(null);
  const cancelAvatarTap = useCallback(() => {
    if (avatarTapTimer.current !== null) {
      window.clearTimeout(avatarTapTimer.current);
      avatarTapTimer.current = null;
    }
  }, []);
  useEffect(() => cancelAvatarTap, [cancelAvatarTap]);
  const handleAvatarClick = useCallback(
    (characterId: string) => {
      if (avatarTapTimer.current !== null) return;
      avatarTapTimer.current = window.setTimeout(() => {
        avatarTapTimer.current = null;
        router.push(characterDetailHref(characterId, `/messages/group/${group.id}`));
      }, 260);
    },
    [group.id, router],
  );

  // Double click avatar triggers poke (拍一拍) - scoped only to clicked message
  const handlePoke = async (characterId: string, characterName: string, messageId?: string) => {
    if (messageId) {
      setPokingMessageId(messageId);
      setTimeout(() => setPokingMessageId((curr) => (curr === messageId ? null : curr)), 550);
    }
    try {
      const tempId = `temp-poke-${Date.now()}`;
      const pokeContent = `${user.name || '我'} 拍了拍 ${characterName}`;
      const optimisticPoke: GroupMessageView = {
        id: tempId,
        groupId: group.id,
        senderType: 'system',
        senderCharacterId: null,
        senderName: '系统',
        senderUsername: 'system',
        senderAvatarEmoji: '🤖',
        senderAvatarColor: 'gray',
        senderAvatarUrl: null,
        content: pokeContent,
        attachments: [],
        replyTo: null,
        mentions: [{ type: 'ai', id: characterId, name: characterName, username: '' }],
        reactions: [],
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, optimisticPoke]);
      scrollToBottom();

      const res = await fetch(`/api/groups/${group.id}/poke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      });
      if (!res.ok) {
        console.error('[GroupChatWindow] poke request failed');
      }
    } catch (err) {
      console.error('[GroupChatWindow] poke error', err);
    }
  };
  // Keyboard navigation when mention picker is open
  useEffect(() => {
    if (!showMentionPicker) {
      setSelectedMentionIndex(0);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (aiMembers.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIndex((prev) => (prev + 1) % aiMembers.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIndex((prev) => (prev - 1 + aiMembers.length) % aiMembers.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = aiMembers[selectedMentionIndex];
        if (selected) {
          insertMention(selected);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionPicker(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [showMentionPicker, selectedMentionIndex, aiMembers]);

  return (
    <div {...stylex.props(styles.root)}>
      {/* Lightbox */}
      <MediaLightbox
        media={activeLightboxMedia}
        onClose={() => setActiveLightboxMedia(null)}
        isDevMode={isDevMode}
        mediaAssetId={activeLightboxMedia?.id}
      />

      {/* Developer Context Inspector Modal */}
      <ChatContextInspector
        isOpen={showDevInspector}
        onClose={() => setShowDevInspector(false)}
        mode="group"
        groupId={group.id}
      />
      {/* Header */}
      <header {...stylex.props(styles.header)}>
        <Link
          href="/messages"
          {...stylex.props(styles.backLink)}
          aria-label="返回群聊列表"
        >
          <ArrowLeft size={19} />
        </Link>
        <UserAvatar
          name={group.name}
          emoji={group.avatarEmoji}
          color={group.avatarColor}
          url={group.avatarUrl}
          size={36}
        />
        <div {...stylex.props(styles.headerInfo)}>
          <div {...stylex.props(styles.headerTitle)}>
            <span {...stylex.props(styles.name)}>{group.name}</span>
            <span {...stylex.props(styles.memberCount)}>
              {members.length}人
            </span>
          </div>
          <Text type="supporting" size="sm" as="div" xstyle={styles.replyText}>
            {group.description || `${members.map((m) => m.name).join('、')}`}
          </Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isDevMode && (
            <Button
              label="开发者工具"
              variant="ghost"
              size="sm"
              icon={<Code2 size={16} />}
              isIconOnly
              tooltip="打开开发者工具 · 查看实时 AI 上下文"
              onClick={() => setShowDevInspector(true)}
            />
          )}
          <Button
            label="群资料"
            variant="ghost"
            size="sm"
            icon={<Info size={15} />}
            onClick={() => setShowInfoDrawer(true)}
          />
        </div>
      </header>

      {/* Messages list */}
      <div {...stylex.props(styles.scrollAreaWrapper)}>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          {...stylex.props(styles.scroll)}
        >
          <div
            {...stylex.props(styles.messages)}
            style={composerHeight ? {paddingBottom: composerHeight} : undefined}
          >
            <ChatMessageList gap={2}>
              {messages.map((m) => {
                const isUser = m.senderType === 'user';
                const isSystem = m.senderType === 'system';

                if (isSystem) {
                  return (
                    <ChatSystemMessage key={m.id} variant="default">
                      {m.content}
                    </ChatSystemMessage>
                  );
                }

                const attachments = m.attachments || [];

                if (isUser) {
                  return (
                    <ChatMessage
                      key={m.id}
                      sender="user"
                      avatar={
                        <UserAvatar name={user.name || '我'} url={user.imageUrl} size={36} />
                      }
                    >
                      {m.replyTo && (
                        <div {...stylex.props(styles.reply)}>
                          <Reply size={12} />
                          <span {...stylex.props(styles.replyText)}>
                            回复 @{m.replyTo.senderName}: {m.replyTo.content}
                          </span>
                        </div>
                      )}
                      <ChatMessageBubble variant="filled">
                        {/* Attachments rendering */}
                        {attachments.length > 0 && (
                          <div
                            {...stylex.props(attachments.length === 1 ? styles.attachmentSingle : styles.attachmentGrid)}
                          >
                            {attachments.map((att) => (
                              <div
                                key={att.id}
                                onClick={() =>
                                  setActiveLightboxMedia({
                                    id: att.id,
                                    url: att.blobUrl,
                                    originalFilename: att.originalFilename,
                                    width: att.width,
                                    height: att.height,
                                    perception: att.perception,
                                  })
                                }
                                {...stylex.props(styles.attachment)}
                              >
                                <SafeImage
                                  src={att.blobUrl}
                                  assetId={att.id}
                                  alt={att.originalFilename || '图片'}
                                  xstyle={styles.image}
                                  loading="lazy"
                                  compactFallback
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        {m.content && m.content !== '[图片]' ? (
                          <p {...stylex.props(styles.messageText)}>{m.content}</p>
                        ) : null}
                      </ChatMessageBubble>
                      {m.reactions && m.reactions.length > 0 && (
                        <div {...stylex.props(styles.reactionsUser)}>
                          {m.reactions.map((rx) => (
                            <button
                              key={rx.emoji}
                              type="button"
                              onClick={() => handleReaction(m.id, rx.emoji)}
                              {...stylex.props(styles.reaction, rx.hasReacted && styles.reacted)}
                            >
                              <span>{rx.emoji}</span>
                              <span {...stylex.props(styles.reactionCount)}>{rx.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </ChatMessage>
                  );
                }

                const isThisMsgPoking = pokingMessageId === m.id;
                const charAvatar = m.senderCharacterId ? (
                  <div
                    onDoubleClick={() => {
                      cancelAvatarTap();
                      handlePoke(m.senderCharacterId!, m.senderName, m.id);
                    }}
                    {...stylex.props(styles.avatarPokeWrap, isThisMsgPoking && styles.avatarPoking)}
                    title="点击查看资料 · 双击拍一拍"
                  >
                    <button
                      type="button"
                      onClick={() => handleAvatarClick(m.senderCharacterId!)}
                      aria-label={`查看 ${m.senderName} 的资料`}
                      {...stylex.props(styles.avatarProfileButton)}
                    >
                      <UserAvatar
                        name={m.senderName}
                        emoji={m.senderAvatarEmoji}
                        color={m.senderAvatarColor}
                        url={m.senderAvatarUrl}
                        size={36}
                      />
                    </button>
                  </div>
                ) : (
                  <UserAvatar
                    name={m.senderName}
                    emoji={m.senderAvatarEmoji}
                    color={m.senderAvatarColor}
                    url={m.senderAvatarUrl}
                    size={36}
                  />
                );

                return (
                  <ChatMessage
                    key={m.id}
                    sender="assistant"
                    name={m.senderName}
                    avatar={charAvatar}
                  >
                    {m.replyTo && (
                      <div {...stylex.props(styles.reply)}>
                        <Reply size={12} />
                        <span {...stylex.props(styles.replyText)}>
                          回复 @{m.replyTo.senderName}: {m.replyTo.content}
                        </span>
                      </div>
                    )}
                    <ChatMessageBubble variant="filled">
                      {/* Attachments rendering */}
                      {attachments.length > 0 && (
                        <div
                          {...stylex.props(attachments.length === 1 ? styles.attachmentSingle : styles.attachmentGrid)}
                        >
                          {attachments.map((att) => (
                            <div
                              key={att.id}
                              onClick={() =>
                                setActiveLightboxMedia({
                                  id: att.id,
                                  url: att.blobUrl,
                                  originalFilename: att.originalFilename,
                                  width: att.width,
                                  height: att.height,
                                  perception: att.perception,
                                })
                              }
                              {...stylex.props(styles.attachment)}
                            >
                              <SafeImage
                                src={att.blobUrl}
                                assetId={att.id}
                                alt={att.originalFilename || '图片'}
                                xstyle={styles.image}
                                loading="lazy"
                                compactFallback
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      {m.content && m.content !== '[图片]' ? (
                        <Markdown xstyle={styles.name}>{m.content}</Markdown>
                      ) : null}
                    </ChatMessageBubble>
                    {m.reactions && m.reactions.length > 0 && (
                      <div {...stylex.props(styles.reactions)}>
                        {m.reactions.map((rx) => (
                          <button
                            key={rx.emoji}
                            type="button"
                            onClick={() => handleReaction(m.id, rx.emoji)}
                            {...stylex.props(styles.reaction, rx.hasReacted && styles.reacted)}
                          >
                            <span>{rx.emoji}</span>
                            <span {...stylex.props(styles.reactionCount)}>{rx.count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </ChatMessage>
                );
              })}
            </ChatMessageList>
          </div>
        </div>
      </div>

      {/* 100% width gradient backdrop (transparent at top to 30% transparent black at bottom, hidden when at bottom) */}
      <div
        aria-hidden="true"
        {...stylex.props(styles.gradientBackdrop, !isAtBottom && styles.gradientBackdropVisible)}
      />

      {/* Floating Borderless Composer */}
      <footer ref={footerRef} {...stylex.props(styles.footer)}>
        <div {...stylex.props(styles.composerFloating)}>
          <div {...stylex.props(styles.composerWrap)}>
            {/* Hidden File Picker */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            disabled={!isVisionEnabled}
            {...stylex.props(styles.hidden)}
            onChange={handleFileSelect}
          />

          {replyingTo && (
            <div {...stylex.props(styles.replyBar)}>
              <div {...stylex.props(styles.replyBarInner)}>
                <Reply size={12} {...stylex.props(styles.smallSecondary)} />
                <span {...stylex.props(styles.smallSecondary)}>回复 @{replyingTo.senderName}:</span>
                <span {...stylex.props(styles.replyText)}>{replyingTo.content}</span>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                {...stylex.props(styles.smallButton)}
              >
                <X size={12} />
              </button>
            </div>
          )}

          {showMentionPicker && (
            <div {...stylex.props(styles.mentionBox)}>
              <div {...stylex.props(styles.mentionHeader)}>
                <span {...stylex.props(styles.mentionLabel)}>
                  <AtSign size={11} />
                  选择要 @ 的群成员
                </span>
                <button
                  type="button"
                  onClick={() => setShowMentionPicker(false)}
                  {...stylex.props(styles.smallButton)}
                >
                  关闭
                </button>
              </div>
              <div {...stylex.props(styles.mentionList)}>
                {aiMembers.map((m, idx) => (
                  <div
                    key={m.id}
                    {...stylex.props(styles.mentionItemWrap)}
                    onMouseEnter={() => setSelectedMentionIndex(idx)}
                  >
                    <Item
                      startContent={
                        <UserAvatar
                          name={m.name}
                          emoji={m.avatarEmoji}
                          color={m.avatarColor}
                          size={24}
                          tooltip={false}
                        />
                      }
                      label={m.name}
                      description={`@${m.username}`}
                      density="compact"
                      layout="inline"
                      isHighlighted={idx === selectedMentionIndex}
                      onClick={() => insertMention(m)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <ChatComposer
            elevation="none"
            xstyle={styles.composerBody}
            placeholder={
              isVisionEnabled && pendingImages.length > 0
                ? '添加说明，或直接发送图片…'
                : `发消息给群聊「${group.name}」…`
            }
            value={inputValue}
            onChange={(v) => {
              setInputValue(v);
              if (v.endsWith('@')) {
                setShowMentionPicker(true);
              }
            }}
            onSubmit={(text) => handleSend(text)}
            isDisabled={isPending || isUploadingAny}
            drawer={
              pendingImages.length > 0 ? (
                <ChatComposerDrawer count={pendingImages.length}>
                  <div {...stylex.props(styles.pendingRow)}>
                    {pendingImages.map((img) => (
                      <div
                        key={img.id}
                        {...stylex.props(styles.pendingItem)}
                      >
                        <div {...stylex.props(styles.preview)}>
                          <SafeImage
                            src={img.previewUrl}
                            alt="待发送图片"
                            showSkeleton={false}
                            showRetry={false}
                            compactFallback
                            xstyle={styles.previewImage}
                          />
                          {img.status === 'uploading' && (
                            <div {...stylex.props(styles.overlayUploading)}>
                              <Loader2 {...stylex.props(styles.spin)} size={16} />
                            </div>
                          )}
                          {img.status === 'error' && (
                            <div {...stylex.props(styles.overlayError)}>
                              <X size={16} />
                            </div>
                          )}
                        </div>

                        <div {...stylex.props(styles.fileInfo)}>
                          <div {...stylex.props(styles.fileName)}>{img.file.name}</div>
                          <div {...stylex.props(styles.fileStatus)}>
                            {img.status === 'uploading'
                              ? '上传中…'
                              : img.status === 'error'
                              ? '上传失败'
                              : `${(img.file.size / 1024).toFixed(0)} KB`}
                          </div>
                        </div>

                        {img.status === 'error' ? (
                          <button
                            type="button"
                            onClick={() => retryUpload(img)}
                            {...stylex.props(styles.iconButton)}
                            title="重试"
                          >
                            <RefreshCw size={14} />
                          </button>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => removePendingImage(img.id)}
                          {...stylex.props(styles.removeButton)}
                          title="移除"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </ChatComposerDrawer>
              ) : undefined
            }
            footerActions={
              <div {...stylex.props(styles.footerActions)}>
                {isVisionEnabled && (
                  <Button
                    label="图片"
                    variant="ghost"
                    size="sm"
                    icon={<ImageIcon size={16} />}
                    aria-label="发送图片"
                    onClick={() => fileInputRef.current?.click()}
                    isDisabled={isUploadingAny || isPending}
                  />
                )}
                <Button
                  label="成员"
                  variant="ghost"
                  size="sm"
                  icon={<AtSign size={15} />}
                  onClick={() => setShowMentionPicker(!showMentionPicker)}
                />
              </div>
            }
          />
        </div>
        </div>
      </footer>

      {/* Group Info Drawer */}
      <GroupInfoDrawer
        group={group}
        members={members}
        allCharacters={allCharacters}
        isOpen={showInfoDrawer}
        onClose={() => setShowInfoDrawer(false)}
      />
    </div>
  );
}
