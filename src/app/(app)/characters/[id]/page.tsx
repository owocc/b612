import { and, desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { aiCharacters, aiMemories, providerConfigs } from '@/db/schema';
import { requireUserId } from '@/lib/session';
import { CharacterCompactProfile, CompactProfileFootNote } from '@/components/character-compact-profile';
import { CharacterEditor, type CharacterFormValues } from '@/components/character-editor';
import { SendMessageButton } from '@/components/send-message-button';
import { getCharacterFeedPosts, getCharacterFeedProfile } from '@/server/feed';
import { normalizeFriendPermission } from '@/server/friend-permissions';
import { CharacterDetailShell } from '@/components/character-detail-shell';
import { sanitizeBackHref } from '@/lib/character-routes';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  const [character] = await db
    .select({ name: aiCharacters.name })
    .from(aiCharacters)
    .where(and(eq(aiCharacters.id, id), eq(aiCharacters.userId, userId)))
    .limit(1);
  return { title: character?.name ?? '联系人' };
}

export default async function CharacterViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; back?: string }>;
}) {
  const { id } = await params;
  const { edit, back } = await searchParams;
  const isEditMode = edit === '1' || edit === 'true';
  // 手机端全屏资料页：`back` 记录来源页（聊天窗口等），刷新 / 深度链接后返回键仍然可用
  const backHref = sanitizeBackHref(back) ?? '/characters';
  const userId = await requireUserId();

  const [character, providers, memories] = await Promise.all([
    db
      .select()
      .from(aiCharacters)
      .where(and(eq(aiCharacters.id, id), eq(aiCharacters.userId, userId)))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({ id: providerConfigs.id, name: providerConfigs.name, providerType: providerConfigs.providerType })
      .from(providerConfigs)
      .where(eq(providerConfigs.userId, userId)),
    db
      .select()
      .from(aiMemories)
      .where(and(eq(aiMemories.characterId, id), eq(aiMemories.userId, userId)))
      .orderBy(desc(aiMemories.importance), desc(aiMemories.createdAt))
      .limit(40),
  ]);

  if (!character) notFound();

  // 保留旧的 ?edit=1 完整编辑器入口（管理页仍会跳转到这里）
  if (isEditMode) {
    const initialValues: CharacterFormValues = {
      name: character.name,
      username: character.username,
      bio: character.bio,
      avatarUrl: character.avatarUrl ?? '',
      avatarEmoji: character.avatarEmoji,
      avatarColor: character.avatarColor,
      persona: character.persona,
      personality: character.personality,
      interests: character.interests,
      expressionStyle: character.expressionStyle,
      relationshipToUser: character.relationshipToUser,
      systemPrompt: character.systemPrompt ?? '',
      status: character.status as 'active' | 'paused',
      chattiness: character.chattiness,
      likeRate: character.likeRate,
      commentRate: character.commentRate,
      postRate: character.postRate,
      dmRate: character.dmRate,
      memoryRetention:
        (character.memoryRetention as 'excellent' | 'normal' | 'slightly_forgetful' | 'forgetful') || 'normal',
      grudgeRate: character.grudgeRate ?? 0.3,
      providerId: character.providerId ?? '',
      modelId: character.modelId ?? '',
      temperature: character.temperature != null ? String(character.temperature) : '',
      topP: character.topP != null ? String(character.topP) : '',
      maxTokens: character.maxTokens != null ? String(character.maxTokens) : '',
    };

    return (
      <CharacterDetailShell title="编辑居民" fallbackHref={`/characters/${character.id}`}>
        <div style={{ maxWidth: '42rem', width: '100%', marginInline: 'auto' }}>
          <CharacterEditor
            characterId={character.id}
            initial={initialValues}
            providers={providers}
            memories={memories}
          />
        </div>
      </CharacterDetailShell>
    );
  }

  const [feedProfile, recentPosts] = await Promise.all([
    getCharacterFeedProfile(userId, character.id),
    getCharacterFeedPosts(userId, character.id, 5, 0),
  ]);

  const recentMedia = recentPosts.flatMap((post) => post.media).slice(0, 3);

  return (
    <CharacterDetailShell title={character.name} fallbackHref={backHref}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
        <CharacterCompactProfile
          character={{
            id: character.id,
            name: character.name,
            username: character.username,
            bio: character.bio,
            relationshipToUser: character.relationshipToUser,
            avatarUrl: character.avatarUrl,
            avatarEmoji: character.avatarEmoji,
            avatarColor: character.avatarColor,
            status: character.status,
            friendPermission: normalizeFriendPermission(character.friendPermission),
          }}
          recentMedia={recentMedia}
          postCount={feedProfile?.postCount ?? 0}
          onSendMessage={
            <SendMessageButton characterId={character.id} label="发消息" width="100%" />
          }
        />
        <CompactProfileFootNote />
      </div>
    </CharacterDetailShell>
  );
}
