import { notFound } from 'next/navigation';
import { requireUserId } from '@/lib/session';
import { getCharacterFeedPosts, getCharacterFeedProfile } from '@/server/feed';
import { normalizeFriendPermission } from '@/server/friend-permissions';
import { CharacterFeedView } from '@/components/character-feed-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  const userId = await requireUserId();
  const data = await getCharacterFeedProfile(userId, characterId);
  return { title: data ? `${data.character.name} 的朋友圈` : '朋友圈' };
}

export default async function CharacterFeedPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  const userId = await requireUserId();

  const [profile, posts] = await Promise.all([
    getCharacterFeedProfile(userId, characterId),
    getCharacterFeedPosts(userId, characterId, 50, 0),
  ]);

  if (!profile) notFound();

  return (
    <CharacterFeedView
      character={{
        ...profile.character,
        bio: profile.character.bio ?? '',
        friendPermission: normalizeFriendPermission(profile.character.friendPermission),
      }}
      posts={posts}
      postCount={profile.postCount}
    />
  );
}
