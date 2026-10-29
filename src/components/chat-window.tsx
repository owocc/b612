'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as stylex from '@stylexjs/stylex';
import { colorVars } from '@astryxdesign/core/theme/tokens.stylex';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Banknote, Code2, Gift, Image as ImageIcon, Loader2, RefreshCw, X } from 'lucide-react';
import { ChatContextInspector } from '@/components/chat-context-inspector';
import { CharacterProfile } from '@/components/character-profile';
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
import { UserAvatar } from '@/components/user-avatar';
import { SafeImage } from '@/components/safe-image';
import { MediaLightbox } from '@/components/media-lightbox';
import { useAppToast } from '@/lib/toast';
import { markRead } from '@/server/actions/chat';
import { acceptTransferAction, claimRedPacketAction, ensureUserWalletAction } from '@/server/actions/wallet';
import { MoneySendDialog, TransferBubble, RedPacketBubble, type TransferPayload, type RedPacketPayload } from '@/components/chat-money';
import type { RedPacketStatusView, TransferStatusView } from '@/server/wallet';
import { useClientSync } from '@/components/client-sync-provider';
import type { aiCharacters } from '@/db/schema';
import type { MediaAssetView } from '@/server/media';

const spin = stylex.keyframes({
  '0%': { transform: 'rotate(0deg)' },
  '100%': { transform: 'rotate(360deg)' },
});

const bounce = stylex.keyframes({
  '0%, 80%, 100%': { transform: 'scale(0)' },
  '40%': { transform: 'scale(1)' },
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
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    position: 'relative',
    backgroundColor: 'var(--color-background-canvas, var(--color-background))',
    overflow: 'hidden',
  },
  header: {
    backgroundColor: 'var(--color-background-surface, var(--color-surface))',
    display: 'flex',
    alignItems: 'center',
    paddingInline: '16px',
    paddingBlock: '14px',
    gap: '12px',
    flexShrink: 0,
    zIndex: 10,
  },
  mobileBack: {
    display: 'none',
    color: colorVars['--color-text-secondary'],
    padding: '4px',
    marginRight: '2px',
    borderRadius: '6px',
    '@media (max-width: 640px)': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  },
  headerInfo: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flex: 1,
  },
  headerName: {
    fontSize: '15px',
    fontWeight: '600',
    color: colorVars['--color-text-primary'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerNameLink: {
    textDecoration: 'none',
    cursor: 'pointer',
    ':hover': {
      textDecoration: 'underline',
    },
  },
  headerStatus: {
    fontSize: '12px',
    color: colorVars['--color-text-secondary'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  scrollAreaWrapper: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  scrollArea: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    paddingInline: '16px',
    paddingTop: '20px',
    paddingBottom: stylex.firstThatWorks('50dvh', '50vh'),
    scrollBehavior: 'smooth',
  },
  messagesInner: {
    width: '100%',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: '60px',
    paddingBottom: '40px',
    textAlign: 'center',
  },
  emptyName: {
    fontSize: '18px',
    fontWeight: '600',
    color: colorVars['--color-text-primary'],
    marginTop: '16px',
    marginBottom: '6px',
  },
  emptyBio: {
    maxWidth: '360px',
    marginBottom: '16px',
    lineHeight: '1.5',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingInline: '16px',
    // 适配 iPhone 底部 Home 指示条（standalone 模式下内容延伸到底部安全区）
    paddingBottom: stylex.firstThatWorks('calc(16px + env(safe-area-inset-bottom))', '16px'),
    paddingTop: '8px',
    zIndex: 10,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  composerFloating: {
    width: '100%',
    pointerEvents: 'auto',
  },
  composerBody: {
    backgroundColor: colorVars['--color-background-surface'],
    borderRadius: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
  },
  gradientBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '140px',
    background: 'linear-gradient(to top, rgba(0, 0, 0, 0.2) 0%, transparent 100%)',
    pointerEvents: 'none',
    zIndex: 5,
    opacity: 0,
    transition: 'opacity 0.2s ease',
  },
  gradientBackdropVisible: {
    opacity: 1,
  },
  userMessage: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
    fontSize: '14px',
    lineHeight: '1.5',
  },
  assistantMarkdown: {
    fontSize: '14px',
    lineHeight: '1.5',
    color: colorVars['--color-text-primary'],
  },
  typing: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    paddingBlock: '4px',
  },
  typingDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: colorVars['--color-text-secondary'],
    display: 'inline-block',
    animationName: bounce,
    animationDuration: '1.4s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
  },
  attachmentSingle: {
    marginBottom: '8px',
    maxWidth: '300px',
    borderRadius: '8px',
    overflow: 'hidden',
    cursor: 'pointer',
  },
  attachmentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
    gap: '6px',
    marginBottom: '8px',
    maxWidth: '320px',
    borderRadius: '8px',
    overflow: 'hidden',
    cursor: 'pointer',
  },
  attachmentImage: {
    width: '100%',
    height: 'auto',
    maxHeight: '260px',
    objectFit: 'cover',
    display: 'block',
    borderRadius: '6px',
    transition: 'transform 0.15s ease',
    ':hover': {
      transform: 'scale(1.02)',
    },
  },
  drawerList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '8px',
  },
  pendingItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px',
    borderRadius: '8px',
    backgroundColor: 'var(--color-background-canvas, var(--color-background))',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
  },
  thumbnail: {
    width: '40px',
    height: '40px',
    borderRadius: '6px',
    overflow: 'hidden',
    position: 'relative',
    flexShrink: 0,
    backgroundColor: colorVars['--color-background-muted'],
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  uploadOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
  },
  errorOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(239, 68, 68, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
  },
  spinner: {
    animationName: spin,
    animationDuration: '1s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'linear',
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: '12px',
    fontWeight: '500',
    color: colorVars['--color-text-primary'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileStatus: {
    fontSize: '11px',
    color: colorVars['--color-text-secondary'],
  },
  iconButton: {
    padding: '4px',
    borderRadius: '4px',
    borderWidth: '0',
    backgroundColor: 'transparent',
    color: colorVars['--color-text-secondary'],
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ':hover': {
      backgroundColor: colorVars['--color-background-muted'],
      color: colorVars['--color-text-primary'],
    },
  },
  iconButtonError: {
    ':hover': {
      color: 'var(--color-danger, #ef4444)',
    },
  },
  footerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  profileOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '380px',
    maxWidth: '100%',
    backgroundColor: colorVars['--color-background-surface'],
    borderLeftWidth: '1px',
    borderLeftStyle: 'solid',
    borderLeftColor: colorVars['--color-border'],
    boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.1)',
    zIndex: 30,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  profileOverlayBar: {
    height: '56px',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colorVars['--color-border'],
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingInline: '16px',
    flexShrink: 0,
  },
  profileOverlayTitle: {
    fontSize: '15px',
    fontWeight: '600',
    color: colorVars['--color-text-primary'],
  },
  profileOverlayBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
  },
  overlayClose: {
    padding: '4px',
    borderRadius: '6px',
    color: colorVars['--color-text-secondary'],
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hidden: {
    display: 'none',
  },
  avatarPokeWrap: {
    display: 'inline-flex',
    cursor: 'pointer',
    userSelect: 'none',
    transformOrigin: 'bottom center',
  },
  avatarPoking: {
    animationName: pokeShake,
    animationDuration: '500ms',
    animationTimingFunction: 'ease-in-out',
  },
});
type CharacterRow = typeof aiCharacters.$inferSelect;

type MessageItem = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  type?: string;
  payload?: Record<string, unknown> | null;
  attachments?: MediaAssetView[];
  createdAt: Date | string | number;
  pending?: boolean;
};

type PendingImage = {
  id: string;
  file: File;
  previewUrl: string;
  status: 'uploading' | 'ready' | 'error';
  assetId?: string;
  blobUrl?: string;
  error?: string;
  perception?: { summary: string | null; ocrText: string | null; status: string; perception?: string | null } | null;
};

export function ChatWindow({
  conversationId,
  character,
  user,
  initialMessages,
  isDevMode = false,
  isVisionEnabled = true,
}: {
  conversationId: string;
  character: CharacterRow;
  user: { name: string; imageUrl: string | null };
  initialMessages: MessageItem[];
  isDevMode?: boolean;
  isVisionEnabled?: boolean;
}) {
  const toast = useAppToast();
  const { refresh: refreshSync, ingestSync } = useClientSync();
  const searchParams = useSearchParams();
  const profileOpen = searchParams?.get('profile') === '1';
  const router = useRouter();

  const [messagesList, setMessagesList] = useState<MessageItem[]>(initialMessages);
  const [isTyping, setIsTyping] = useState(false);
  const [pokingMessageId, setPokingMessageId] = useState<string | null>(null);
  const [turnStatus, setTurnStatus] = useState<string>('idle');
  const [showDevInspector, setShowDevInspector] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [redPacketsMap, setRedPacketsMap] = useState<Record<string, RedPacketStatusView>>({});
  const [transfersMap, setTransfersMap] = useState<Record<string, TransferStatusView>>({});
  const [moneyDialogOpen, setMoneyDialogOpen] = useState(false);
  const [activeLightboxMedia, setActiveLightboxMedia] = useState<{
    id?: string | null;
    url: string;
    originalFilename?: string | null;
    width?: number | null;
    height?: number | null;
    perception?: { summary?: string | null; ocrText?: string | null; status?: string } | null;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const stickToBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // 悬浮输入框实测高度（含安全区与上下内边距），用作消息列表的底部 padding
  const [composerHeight, setComposerHeight] = useState(0);
  // 已在可视范围内看过的最后一条 AI 消息（挂载时 markRead 覆盖了初始消息，故以初始值为起点）
  const lastSeenAssistantIdRef = useRef<string | null>(
    [...initialMessages].reverse().find((m) => m.role === 'assistant')?.id ?? null,
  );

  // Poll conversation-specific sync
  const pollConversation = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/sync?conversationId=${conversationId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok) return;

      // 复用响应中现成的全局未读数与会话列表，
      // 让侧栏列表/导航角标与聊天窗口保持同一更新节奏（避免列表延迟）
      ingestSync({ unread: data.unread, chats: data.chats });
      if (!data.conversation) return;

      const serverMsgs: MessageItem[] = (data.conversation.messages || []).map((m: {
        id: string;
        role: 'user' | 'assistant' | 'system';
        content: string;
        type?: string;
        payload?: Record<string, unknown> | null;
        attachments?: MediaAssetView[];
        createdAt: string;
      }) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        type: m.type ?? 'text',
        payload: m.payload ?? null,
        attachments: m.attachments,
        createdAt: m.createdAt,
      }));

      if (data.conversation.redPackets) {
        setRedPacketsMap(data.conversation.redPackets as Record<string, RedPacketStatusView>);
      }
      if (data.conversation.transfers) {
        setTransfersMap(data.conversation.transfers as Record<string, TransferStatusView>);
      }

      // Merge server messages with any optimistic pending user messages
      setMessagesList((prev) => {
        const pending = prev.filter((p) => p.pending);
        const unresolvedPending = pending.filter(
          (p) => !serverMsgs.some((s) => s.role === 'user' && s.content === p.content),
        );
        return [...serverMsgs, ...unresolvedPending];
      });

      setIsTyping(data.conversation.isTyping);
      setTurnStatus(data.conversation.turnStatus);
    } catch (err) {
      console.error('[ChatWindow] sync error', err);
    }
  }, [conversationId, ingestSync]);

  useEffect(() => {
    markRead(conversationId);
    pollConversation();
    // 确保用户钱包已开户（首次聊天时自动开户赠送）
    ensureUserWalletAction().catch(() => {});

    // Fast polling in active chat window for real-time responsiveness
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        pollConversation();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [conversationId, pollConversation]);

  // 停留在会话底部时，新到达的消息一旦可见即标记已读，
  // markConversationRead 会同步清除该会话的通知中心未读记录（Telegram/QQ 逻辑）
  useEffect(() => {
    if (!isAtBottom || document.visibilityState !== 'visible') return;
    const lastAssistant = [...messagesList].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant || lastAssistant.id === lastSeenAssistantIdRef.current) return;
    lastSeenAssistantIdRef.current = lastAssistant.id;
    markRead(conversationId)
      .then(() => refreshSync())
      .catch(() => {});
  }, [isAtBottom, messagesList, conversationId, refreshSync]);

  // 瞬时跳到最底部（临时覆盖 scrollArea 的 smooth 行为），用于进入会话时直接查看最新消息
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

  // 点击消息列表进入会话后直接跳到最底部：
  // 初始渲染、markdown/图片加载会持续撑高内容，需要在帧内多次校正，
  // 并监听图片 load（捕获阶段）保持贴底
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
  }, [conversationId, scrollToEndInstant]);

  // Auto-scroll when new messages arrive or typing status changes
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setIsAtBottom(true);
    } else if (el) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 15;
      setIsAtBottom(atBottom);
    }
  }, [messagesList, isTyping]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = remaining <= 15;
    stickToBottomRef.current = remaining < 80;
    setIsAtBottom(atBottom);
  };

  useEffect(() => {
    const scrollToBottom = () => {
      const el = scrollRef.current;
      if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    };
    window.addEventListener('resize', scrollToBottom);
    return () => window.removeEventListener('resize', scrollToBottom);
  }, []);

  // Upload an image attachment
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
                perception: data.media.perception || data.perception || null,
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

  // Submit user message asynchronously (instant return)
  const handleSubmit = async (text: string) => {
    if (isUploadingAny) return;

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
            perception: i.perception
              ? {
                  status: i.perception.status || 'completed',
                  summary: i.perception.summary || null,
                  ocrText: i.perception.ocrText || null,
                  perception: i.perception.perception || null,
                }
              : null,
            createdAt: new Date(),
          }))
      : [];
    const mediaAssetIds = readyAttachments.map((a) => a.id);

    if (!text.trim() && mediaAssetIds.length === 0) return;

    stickToBottomRef.current = true;
    const tempMsgId = `pending-${crypto.randomUUID()}`;

    // Optimistic UI update: instantly show user message
    const optimisticMessage: MessageItem = {
      id: tempMsgId,
      role: 'user',
      content: text.trim(),
      attachments: readyAttachments,
      createdAt: new Date(),
      pending: true,
    };

    setMessagesList((prev) => [...prev, optimisticMessage]);
    setPendingImages([]);
    setIsTyping(true); // Optimistically show typing as Turn becomes collecting

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          content: text.trim(),
          mediaAssetIds,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.error || '消息发送失败');
        return;
      }

      // Re-poll immediately to sync state
      await pollConversation();
      refreshSync();
    } catch (err) {
      console.error('[ChatWindow] send message error:', err);
      toast.error('网络错误，发送失败');
    }
  };

  // 点击红包气泡：领取并刷新消息与钱包状态
  const handleClaimRedPacket = async (redPacketId: string) => {
    try {
      const res = await claimRedPacketAction({ id: redPacketId });
      if (res?.error) {
        toast.error(res.error);
      } else if (res?.ok) {
        toast.success('已领取红包');
      }
    } catch (err) {
      console.error('[ChatWindow] claim red packet error', err);
      toast.error('网络错误，领取失败');
    }
    await pollConversation();
  };

  // 点击转账气泡：确认收款
  const handleAcceptTransfer = async (transferId: string) => {
    try {
      const res = await acceptTransferAction({ id: transferId });
      if (res?.error) {
        toast.error(res.error);
      } else if (res?.ok) {
        toast.success('已收款');
        setTransfersMap((prev) => {
          const old = prev[transferId];
          return {
            ...prev,
            [transferId]: {
              transferId,
              status: 'claimed',
              amount: res.amount ?? old?.amount ?? 0,
              currency: res.currency ?? old?.currency ?? 'nw',
              note: old?.note ?? null,
              senderType: old?.senderType ?? 'ai',
              myClaimedAmount: res.amount ?? old?.myClaimedAmount ?? 0,
              claimedAt: new Date(),
            },
          };
        });
      }
    } catch (err) {
      console.error('[ChatWindow] accept transfer error', err);
      toast.error('网络错误，收款失败');
    }
    await pollConversation();
    refreshSync();
  };

  // 双击头像触发 poke (拍一拍)
  const handlePoke = async (targetId?: string) => {
    if (targetId) {
      setPokingMessageId(targetId);
      setTimeout(() => setPokingMessageId((curr) => (curr === targetId ? null : curr)), 550);
    }
    try {
      const res = await fetch('/api/chat/poke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      });
      const data = await res.json();
      if (data.ok) {
        setIsTyping(true);
        await pollConversation();
        refreshSync();
      }
    } catch (err) {
      console.error('[ChatWindow] poke error', err);
    }
  };

  const renderAvatar = (messageId?: string) => {
    const isThisPoking = messageId ? pokingMessageId === messageId : false;
    return (
      <div
        onDoubleClick={() => handlePoke(messageId || 'header')}
        {...stylex.props(styles.avatarPokeWrap, isThisPoking && styles.avatarPoking)}
        title="双击拍一拍"
      >
        <UserAvatar
          name={character.name}
          emoji={character.avatarEmoji}
          color={character.avatarColor}
          url={character.avatarUrl}
          size={36}
        />
      </div>
    );
  };
  const userAvatar = (
    <UserAvatar name={user.name || '我'} url={user.imageUrl} size={36} />
  );

  return (
    <div {...stylex.props(styles.root)}>
      {/* Lightbox Modal */}
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
        mode="dm"
        conversationId={conversationId}
      />

      {/* 转账 / 红包发送对话框 */}
      <MoneySendDialog
        conversationId={conversationId}
        characterName={character.name}
        isOpen={moneyDialogOpen}
        onOpenChange={setMoneyDialogOpen}
        onSent={() => {
          pollConversation();
          refreshSync();
        }}
      />

      <header {...stylex.props(styles.header)}>
        <Link
          href="/messages"
          {...stylex.props(styles.mobileBack)}
          aria-label="返回会话列表"
        >
          <ArrowLeft size={19} />
        </Link>
        {renderAvatar('header')}
        <div {...stylex.props(styles.headerInfo)}>
          <Link
            href={`/messages/${conversationId}?profile=1`}
            onClick={(event) => {
              // 手机端直接进入全屏资料页，桌面端继续用聊天内浮层
              if (window.matchMedia('(max-width: 639px)').matches) {
                event.preventDefault();
                router.push(`/characters/${character.id}`);
              }
            }}
            {...stylex.props(styles.headerName, styles.headerNameLink)}
          >
            {isTyping ? '正在输入中...' : character.name}
          </Link>
        </div>
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
      </header>

      {/* messages list */}
      <div {...stylex.props(styles.scrollAreaWrapper)}>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          {...stylex.props(styles.scrollArea)}
          style={composerHeight ? {paddingBottom: composerHeight} : undefined}
        >
          <div {...stylex.props(styles.messagesInner)}>
            {messagesList.length === 0 ? (
              <div {...stylex.props(styles.emptyState)}>
                <UserAvatar
                  name={character.name}
                  emoji={character.avatarEmoji}
                  color={character.avatarColor}
                  url={character.avatarUrl}
                  size={72}
                />
                <div {...stylex.props(styles.emptyName)}>{character.name}</div>
                <Text type="supporting" as="p" xstyle={styles.emptyBio}>
                  {character.bio}
                </Text>
                <Text type="supporting" size="sm" as="p">
                  打个招呼，开启你们的对话吧
                </Text>
              </div>
            ) : (
              <ChatMessageList gap={2}>
                {messagesList.map((m) => {
                  const isUser = m.role === 'user';
                  const isSystem = m.role === 'system';
                  const attachments = m.attachments || [];

                  if (isSystem) {
                    return (
                      <ChatSystemMessage key={m.id} variant="default">
                        {m.content}
                      </ChatSystemMessage>
                    );
                  }

                  return (
                    <ChatMessage
                      key={m.id}
                      sender={isUser ? 'user' : 'assistant'}
                      avatar={isUser ? userAvatar : renderAvatar(m.id)}
                    >
                      {m.type === 'transfer' && m.payload ? (
                        <TransferBubble
                          payload={m.payload as unknown as TransferPayload}
                          status={transfersMap[String((m.payload as Record<string, unknown>).transferId)]}
                          senderIsUser={isUser}
                          characterName={character.name}
                          onAccept={handleAcceptTransfer}
                        />
                      ) : m.type === 'red_packet' && m.payload ? (
                        <RedPacketBubble
                          payload={m.payload as unknown as RedPacketPayload}
                          status={redPacketsMap[String((m.payload as Record<string, unknown>).redPacketId)]}
                          senderIsUser={isUser}
                          characterName={character.name}
                          onClaim={handleClaimRedPacket}
                        />
                      ) : (
                        <ChatMessageBubble variant="filled">
                        {/* Image attachments display */}
                        {attachments.length > 0 && (
                          <div
                            {...stylex.props(
                              attachments.length === 1
                                ? styles.attachmentSingle
                                : styles.attachmentGrid,
                            )}
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
                              >
                                <SafeImage
                                  src={att.blobUrl}
                                  assetId={att.id}
                                  alt={att.originalFilename || '图片'}
                                  xstyle={styles.attachmentImage}
                                  loading="lazy"
                                  compactFallback
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {m.content && m.content.trim() ? (
                          isUser ? (
                            <p {...stylex.props(styles.userMessage)}>{m.content}</p>
                          ) : (
                            <Markdown xstyle={styles.assistantMarkdown}>{m.content}</Markdown>
                          )
                        ) : null}
                      </ChatMessageBubble>
                      )}
                    </ChatMessage>
                  );
                })}
              </ChatMessageList>
            )}
          </div>
        </div>
      </div>

      {/* Gradient backdrop */}
      <div
        aria-hidden="true"
        {...stylex.props(styles.gradientBackdrop, !isAtBottom && styles.gradientBackdropVisible)}
      />

      {/* Floating Borderless Composer */}
      <footer ref={footerRef} {...stylex.props(styles.footer)}>
        <div {...stylex.props(styles.composerFloating)}>
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

          <ChatComposer
            elevation="none"
            xstyle={styles.composerBody}
            placeholder={
              isVisionEnabled && pendingImages.length > 0
                ? '添加说明，或直接发送图片…'
                : `给 ${character.name} 发消息…`
            }
            onSubmit={handleSubmit}
            isStopShown={false}
            drawer={
              pendingImages.length > 0 ? (
                <ChatComposerDrawer count={pendingImages.length}>
                  <div {...stylex.props(styles.drawerList)}>
                    {pendingImages.map((img) => (
                      <div key={img.id} {...stylex.props(styles.pendingItem)}>
                        <div {...stylex.props(styles.thumbnail)}>
                          <SafeImage
                            src={img.previewUrl}
                            alt="待发送图片"
                            showSkeleton={false}
                            showRetry={false}
                            compactFallback
                            xstyle={styles.thumbnailImage}
                          />
                          {img.status === 'uploading' && (
                            <div {...stylex.props(styles.uploadOverlay)}>
                              <Loader2 {...stylex.props(styles.spinner)} size={16} />
                            </div>
                          )}
                          {img.status === 'error' && (
                            <div {...stylex.props(styles.errorOverlay)}>
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
                          {...stylex.props(styles.iconButton, styles.iconButtonError)}
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
                <Button
                  label="转账"
                  variant="ghost"
                  size="sm"
                  icon={<Banknote size={16} />}
                  aria-label="转账"
                  onClick={() => setMoneyDialogOpen(true)}
                />
                <Button
                  label="红包"
                  variant="ghost"
                  size="sm"
                  icon={<Gift size={16} />}
                  aria-label="发红包"
                  onClick={() => setMoneyDialogOpen(true)}
                />
                {isVisionEnabled && (
                  <Button
                    label="图片"
                    variant="ghost"
                    size="sm"
                    icon={<ImageIcon size={16} />}
                    aria-label="发送图片"
                    onClick={() => fileInputRef.current?.click()}
                    isDisabled={isUploadingAny}
                  />
                )}
              </div>
            }
          />
        </div>
      </footer>

      {profileOpen && (
        <div
          {...stylex.props(styles.profileOverlay)}
          role="dialog"
          aria-label={`${character.name} 的资料`}
        >
          <div {...stylex.props(styles.profileOverlayBar)}>
            <span {...stylex.props(styles.profileOverlayTitle)}>居民资料</span>
            <Link href={`/characters/${character.id}/profile`}>
              <Button label="完整资料页" variant="ghost" size="sm" />
            </Link>
            <Link
              href={`/messages/${conversationId}`}
              {...stylex.props(styles.overlayClose)}
              aria-label="关闭资料"
            >
              <X size={18} />
            </Link>
          </div>
          <div {...stylex.props(styles.profileOverlayBody)}>
            <CharacterProfile character={character} />
          </div>
        </div>
      )}
    </div>
  );
}
