import { notFound } from 'next/navigation';
import { ChatWindow } from '@/components/chat-window';
import { requireUserId } from '@/lib/session';
import { getConversation, getConversationMessages } from '@/server/chat';
import { getUserProfile } from '@/server/feed';
import { getDeveloperConfig, getVisionConfig } from '@/server/settings';

export const dynamic = 'force-dynamic';

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  const [conv, devConfig, profile, visionCfg] = await Promise.all([
    getConversation(userId, id),
    getDeveloperConfig(userId),
    getUserProfile(userId),
    getVisionConfig(userId),
  ]);
  if (!conv) notFound();

  const msgs = await getConversationMessages(id, 100);
  return (
    <ChatWindow
      conversationId={id}
      character={conv.character}
      user={{ name: profile?.name ?? '', imageUrl: profile?.image ?? null }}
      initialMessages={msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: m.attachments,
        createdAt: m.createdAt,
      }))}
      isDevMode={devConfig?.enabled ?? false}
      isVisionEnabled={visionCfg?.enabled ?? true}
    />
  );
}
