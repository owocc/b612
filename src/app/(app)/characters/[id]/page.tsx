import {and, eq} from 'drizzle-orm';
import {notFound, redirect} from 'next/navigation';
import {db} from '@/db';
import {aiCharacters} from '@/db/schema';
import {requireUserId} from '@/lib/session';
import {CharacterMiniProfile} from '@/components/character-mini-profile';
import {CharacterDetailShell} from '@/components/character-detail-shell';
import {sanitizeBackHref} from '@/lib/character-routes';
import {getCharacterFeedPosts} from '@/server/feed';

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
  searchParams: Promise<{edit?: string; back?: string}>;
}) {
  const {id} = await params;
  const {edit, back} = await searchParams;
  const isEditMode = edit === '1' || edit === 'true';
  // 手机端全屏资料页：`back` 记录来源页（聊天窗口等），刷新 / 深度链接后返回键仍然可用
  const backHref = sanitizeBackHref(back) ?? '/characters';
  const userId = await requireUserId();

  const [character, recentPosts] = await Promise.all([
    db
      .select({
        id: aiCharacters.id,
        name: aiCharacters.name,
        username: aiCharacters.username,
        bio: aiCharacters.bio,
        avatarUrl: aiCharacters.avatarUrl,
        avatarEmoji: aiCharacters.avatarEmoji,
        avatarColor: aiCharacters.avatarColor,
        relationshipToUser: aiCharacters.relationshipToUser,
      })
      .from(aiCharacters)
      .where(and(eq(aiCharacters.id, id), eq(aiCharacters.userId, userId)))
      .limit(1)
      .then((rows) => rows[0]),
    getCharacterFeedPosts(userId, id, 12).catch((err) => {
      console.error('[character detail] load recent feed posts failed:', err);
      return [];
    }),
  ]);

  if (!character) notFound();

  // 编辑入口只保留在完整资料页，旧链接直接无缝转发过去
  if (isEditMode) redirect(`/characters/${character.id}/profile?edit=1`);

  // 朋友圈条目只需要最近几条动态里的图片缩略图
  const recentPhotos = recentPosts.flatMap((post) => post.media).slice(0, 3);

  return (
    <CharacterDetailShell title={character.name} fallbackHref={backHref}>
      <CharacterMiniProfile character={character} recentPhotos={recentPhotos} />
    </CharacterDetailShell>
  );
}
