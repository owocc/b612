import {and, desc, eq, or} from 'drizzle-orm';
import {notFound} from 'next/navigation';
import {db} from '@/db';
import {aiCharacters, aiMemories, aiRelationships, providerConfigs} from '@/db/schema';
import {requireUserId} from '@/lib/session';
import {getOrCreateWalletAccount} from '@/server/wallet';
import {CharacterProfile} from '@/components/character-profile';
import {FriendSettingsCard} from '@/components/friend-settings-card';
import {normalizeFriendPermission} from '@/server/friend-permissions';
import {CharacterEditor, type CharacterFormValues} from '@/components/character-editor';
import {CharacterWorkshopLauncher} from '@/components/character-workshop/character-workshop-dialog';
import {CharacterAssetsPanel} from '@/components/character-assets/character-assets-panel';
import {CharacterDetailTabs} from '@/components/character-assets/character-detail-tabs';
import {listCharacterAssets} from '@/server/character-assets';
import type {CharacterAssetView} from '@/lib/character-assets';
import {SendMessageButton} from '@/components/send-message-button';
import {Button} from '@astryxdesign/core/Button';
import {Settings2} from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export async function generateMetadata({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  const userId = await requireUserId();
  const [character] = await db
    .select({name: aiCharacters.name})
    .from(aiCharacters)
    .where(and(eq(aiCharacters.id, id), eq(aiCharacters.userId, userId)))
    .limit(1);
  return {title: character?.name ?? '联系人'};
}

export default async function CharacterViewPage({
  params,
  searchParams,
}: {
  params: Promise<{id: string}>;
  searchParams: Promise<{edit?: string}>;
}) {
  const {id} = await params;
  const {edit} = await searchParams;
  const isEditMode = edit === '1' || edit === 'true';
  const userId = await requireUserId();

  const [character, providers, memories] = await Promise.all([
    db
      .select()
      .from(aiCharacters)
      .where(and(eq(aiCharacters.id, id), eq(aiCharacters.userId, userId)))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({id: providerConfigs.id, name: providerConfigs.name, providerType: providerConfigs.providerType})
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

  // 钱包：查看该居民的余额（首次访问自动开户，含开户赠送）
  let walletBalance: number | null = null;
  try {
    const wallet = await getOrCreateWalletAccount({userId, ownerType: 'ai', characterId: character.id});
    walletBalance = wallet.balance;
  } catch {
    walletBalance = null;
  }

  // 好友列表：任一方向的关系登记即互为好友（与社区引擎的可见性判定一致）
  const friendRows = await db
    .select({
      kind: aiRelationships.kind,
      fromId: aiRelationships.fromCharacterId,
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
    .where(and(eq(aiRelationships.userId, userId), or(eq(aiRelationships.fromCharacterId, id), eq(aiRelationships.toCharacterId, id))));

  const friends = friendRows
    .map((row) => ({
      ...row.friend,
      kind: row.kind,
    }))
    .filter((f) => f.id !== id)
    // 同一好友可能有两个方向的登记，按 id 去重
    .filter((f, i, arr) => arr.findIndex((x) => x.id === f.id) === i);

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
      memoryRetention: (character.memoryRetention as 'excellent' | 'normal' | 'slightly_forgetful' | 'forgetful') || 'normal',
      grudgeRate: character.grudgeRate ?? 0.3,
      providerId: character.providerId ?? '',
      modelId: character.modelId ?? '',
      temperature: character.temperature != null ? String(character.temperature) : '',
      topP: character.topP != null ? String(character.topP) : '',
      maxTokens: character.maxTokens != null ? String(character.maxTokens) : '',
    };

    return (
      <div style={{ maxWidth: '42rem', width: '100%', marginInline: 'auto' }}>
        <CharacterEditor
          characterId={character.id}
          initial={initialValues}
          providers={providers}
          memories={memories}
        />
      </div>
    );
  }

  const provider = character.providerId
    ? providers.find((p) => p.id === character.providerId)
    : undefined;

  const modelText = character.providerId
    ? `${provider?.name ?? '未知提供方'} / ${character.modelId ?? '默认模型'}`
    : (character.modelId ? `全局 / ${character.modelId}` : null);

  // 形象资产：列表查询失败不应阻断整个详情页（例如旧库尚未迁移）
  let assets: CharacterAssetView[] = [];
  try {
    assets = await listCharacterAssets(userId, character.id);
  } catch (err) {
    console.error('[character detail] load assets failed:', err);
    assets = [];
  }

  const profile = (
    <CharacterProfile
      character={character}
      modelText={modelText ?? undefined}
      memories={memories}
      friends={friends}
      walletBalance={walletBalance}
      friendSettings={
        <FriendSettingsCard
          characterId={character.id}
          friendPermission={normalizeFriendPermission(character.friendPermission)}
          hideMyPostsFromThem={character.hideMyPostsFromThem}
          hideTheirPostsFromMe={character.hideTheirPostsFromMe}
        />
      }
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SendMessageButton characterId={character.id} />
          <CharacterWorkshopLauncher
            character={{
              id: character.id,
              name: character.name,
              persona: character.persona,
              personality: character.personality,
              interests: character.interests,
              relationshipToUser: character.relationshipToUser,
              bio: character.bio,
            }}
          />
          <Link href={`/characters/${character.id}?edit=1`} style={{ textDecoration: 'none' }}>
            <Button
              label="编辑居民"
              variant="secondary"
              icon={<Settings2 size={15} />}
            />
          </Link>
        </div>
      }
    />
  );

  return (
    <CharacterDetailTabs
      profile={profile}
      assetCount={assets.length}
      assets={<CharacterAssetsPanel characterId={character.id} initialAssets={assets} />}
    />
  );
}
