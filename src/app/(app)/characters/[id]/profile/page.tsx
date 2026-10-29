import { and, desc, eq, or } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import {
  aiCharacters,
  aiMemories,
  aiRelationships,
  conversations,
  modelConfigs,
  providerConfigs,
} from '@/db/schema';
import { requireUserId } from '@/lib/session';
import { getOrCreateWalletAccount } from '@/server/wallet';
import { normalizeFriendPermission } from '@/server/friend-permissions';
import { listCharacterAssets } from '@/server/character-assets';
import type { CharacterAssetView } from '@/lib/character-assets';
import { CharacterArchiveTabs } from '@/components/character-archive/character-archive-tabs';
import { CharacterSettingsPanel } from '@/components/character-archive/character-settings-panel';
import { CharacterSecurityPanel } from '@/components/character-archive/character-security-panel';
import { ArchiveFriendsList } from '@/components/character-archive/archive-friends-list';
import { CharacterAssetsPanel } from '@/components/character-assets/character-assets-panel';
import { FriendSettingsCard } from '@/components/friend-settings-card';
import type { CharacterFriend } from '@/components/character-profile';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  const [character] = await db
    .select({ name: aiCharacters.name })
    .from(aiCharacters)
    .where(and(eq(aiCharacters.id, id), eq(aiCharacters.userId, userId)))
    .limit(1);
  return { title: character ? `${character.name} · 完整资料` : '完整资料' };
}

export default async function CharacterArchivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();

  const [character, providers, models, memories, conversation] = await Promise.all([
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
      .select({ providerId: modelConfigs.providerId, modelId: modelConfigs.modelId })
      .from(modelConfigs)
      .where(eq(modelConfigs.userId, userId)),
    db
      .select()
      .from(aiMemories)
      .where(and(eq(aiMemories.characterId, id), eq(aiMemories.userId, userId)))
      .orderBy(desc(aiMemories.importance), desc(aiMemories.createdAt))
      .limit(40),
    db
      .select({
        id: conversations.id,
        isPinned: conversations.isPinned,
        isArchived: conversations.isArchived,
      })
      .from(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.characterId, id)))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!character) notFound();

  const [friendRows, assetsResult, walletResult] = await Promise.all([
    db
      .select({
        kind: aiRelationships.kind,
        friend: {
          id: aiCharacters.id,
          name: aiCharacters.name,
          username: aiCharacters.username,
          avatarUrl: aiCharacters.avatarUrl,
          avatarEmoji: aiCharacters.avatarEmoji,
          avatarColor: aiCharacters.avatarColor,
        },
      })
      .from(aiRelationships)
      .innerJoin(
        aiCharacters,
        or(
          and(eq(aiRelationships.toCharacterId, aiCharacters.id), eq(aiRelationships.fromCharacterId, id)),
          and(eq(aiRelationships.fromCharacterId, aiCharacters.id), eq(aiRelationships.toCharacterId, id)),
        ),
      )
      .where(
        and(
          eq(aiRelationships.userId, userId),
          or(eq(aiRelationships.fromCharacterId, id), eq(aiRelationships.toCharacterId, id)),
        ),
      ),
    listCharacterAssets(userId, id).catch((err) => {
      console.error('[character archive] load assets failed:', err);
      return [] as CharacterAssetView[];
    }),
    getOrCreateWalletAccount({ userId, ownerType: 'ai', characterId: id }).catch(() => null),
  ]);

  const friends: CharacterFriend[] = friendRows
    .map((row) => ({ ...row.friend, kind: row.kind }))
    .filter((friend) => friend.id !== id)
    .filter((friend, index, list) => list.findIndex((item) => item.id === friend.id) === index);

  const modelsByProvider: Record<string, string[]> = {};
  for (const model of models) {
    (modelsByProvider[model.providerId] ??= []).push(model.modelId);
  }

  const settings = (
    <CharacterSettingsPanel
      character={{
        id: character.id,
        bio: character.bio,
        relationshipToUser: character.relationshipToUser,
        persona: character.persona,
        personality: character.personality,
        interests: character.interests,
        expressionStyle: character.expressionStyle,
        memoryRetention:
          (character.memoryRetention as 'excellent' | 'normal' | 'slightly_forgetful' | 'forgetful') || 'normal',
        grudgeRate: character.grudgeRate ?? 0.3,
        systemPrompt: character.systemPrompt,
        providerId: character.providerId,
        modelId: character.modelId,
        temperature: character.temperature,
        topP: character.topP,
        maxTokens: character.maxTokens,
      }}
      providers={providers}
      modelsByProvider={modelsByProvider}
      memories={memories}
    />
  );

  const assets = <CharacterAssetsPanel characterId={character.id} initialAssets={assetsResult} />;

  const security = (
    <CharacterSecurityPanel
      characterId={character.id}
      status={character.status}
      friendSettings={
        <FriendSettingsCard
          characterId={character.id}
          friendPermission={normalizeFriendPermission(character.friendPermission)}
          hideMyPostsFromThem={character.hideMyPostsFromThem}
          hideTheirPostsFromMe={character.hideTheirPostsFromMe}
        />
      }
      friendsNode={<ArchiveFriendsList friends={friends} />}
      walletBalance={walletResult?.balance ?? null}
      conversation={conversation}
    />
  );

  return (
    <CharacterArchiveTabs
      characterId={character.id}
      characterName={character.name}
      settings={settings}
      assets={assets}
      security={security}
      assetCount={assetsResult.length}
    />
  );
}
