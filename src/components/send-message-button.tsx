'use client';

import {useRouter} from 'next/navigation';
import {MessageCircle} from 'lucide-react';
import {Button} from '@astryxdesign/core/Button';
import {useAppToast} from '@/lib/toast';
import {openConversation} from '@/server/actions/chat';

export function SendMessageButton({
  characterId,
  label = '发私信',
  width = 'auto',
  variant = 'primary',
}: {
  characterId: string;
  label?: string;
  width?: number | string;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const router = useRouter();
  const toast = useAppToast();

  const chat = async () => {
    const res = await openConversation(characterId);
    if (res.id) router.push(`/messages/${res.id}`);
    else toast.error(res.error ?? '打开会话失败');
  };

  return <Button label={label} variant={variant} width={width} icon={<MessageCircle size={16} />} onClick={chat} />;
}
