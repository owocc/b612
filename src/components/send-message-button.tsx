'use client';

import type { ReactNode } from 'react';
import {useRouter} from 'next/navigation';
import {MessageCircle} from 'lucide-react';
import {Button} from '@astryxdesign/core/Button';
import {useAppToast} from '@/lib/toast';
import {openConversation} from '@/server/actions/chat';

export function SendMessageButton({
  characterId,
  label = '发私信',
  icon,
  width,
  size,
}: {
  characterId: string;
  /** 按钮文案（默认「发私信」，名片页传「发消息」） */
  label?: string;
  icon?: ReactNode;
  width?: string | number;
  size?: 'sm' | 'md' | 'lg';
}) {
  const router = useRouter();
  const toast = useAppToast();

  const chat = async () => {
    const res = await openConversation(characterId);
    if (res.id) router.push(`/messages/${res.id}`);
    else toast.error(res.error ?? '打开会话失败');
  };

  return (
    <Button
      label={label}
      variant="primary"
      icon={icon ?? <MessageCircle size={16} />}
      width={width}
      size={size}
      onClick={chat}
    />
  );
}
