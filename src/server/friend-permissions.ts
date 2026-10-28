import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { aiCharacters } from '@/db/schema';

/**
 * 朋友权限 / 朋友圈可见性
 *
 * - 朋友权限：`feed_and_chat`（朋友圈和聊天）| `chat_only`（仅聊天）
 *   「仅聊天」下双方都看不到对方的朋友圈：居民读不到我的动态，我的朋友圈列表也不展示 TA 的动态，
 *   但聊天、转账、群聊不受影响；TA 自己仍然可以发动态（可单独进入 TA 的朋友圈查看）。
 * - 朋友圈状态：`hideMyPostsFromThem`（不让他看我）、`hideTheirPostsFromMe`（不看他）。
 *   两个开关互相独立，仅在「朋友圈和聊天」下可配置。
 *
 * 可见性判定放在查询/引擎层，所以历史数据同样生效（不改写任何已有 posts 记录）。
 */

export type FriendPermission = 'feed_and_chat' | 'chat_only';

export type FriendFeedSettings = {
  friendPermission: string | null;
  hideMyPostsFromThem: boolean | null;
  hideTheirPostsFromMe: boolean | null;
};

export function normalizeFriendPermission(value: string | null | undefined): FriendPermission {
  return value === 'chat_only' ? 'chat_only' : 'feed_and_chat';
}

/** 该居民能否看到我发布的朋友圈（决定 TA 能否评论/点赞我的动态） */
export function canCharacterSeeMyPosts(
  settings: Partial<FriendFeedSettings> | null | undefined,
): boolean {
  if (!settings) return true;
  if (normalizeFriendPermission(settings.friendPermission) === 'chat_only') return false;
  return !settings.hideMyPostsFromThem;
}

/** 我的朋友圈列表是否展示该居民的动态（单独查看 TA 的朋友圈不受此限制） */
export function isCharacterVisibleInMyFeed(
  settings: Partial<FriendFeedSettings> | null | undefined,
): boolean {
  if (!settings) return true;
  if (normalizeFriendPermission(settings.friendPermission) === 'chat_only') return false;
  return !settings.hideTheirPostsFromMe;
}

/** 我的朋友圈查询需要排除的居民 id（新旧数据统一在查询层过滤） */
export async function getFeedHiddenCharacterIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({
      id: aiCharacters.id,
      friendPermission: aiCharacters.friendPermission,
      hideMyPostsFromThem: aiCharacters.hideMyPostsFromThem,
      hideTheirPostsFromMe: aiCharacters.hideTheirPostsFromMe,
    })
    .from(aiCharacters)
    .where(eq(aiCharacters.userId, userId));

  return rows.filter((row) => !isCharacterVisibleInMyFeed(row)).map((row) => row.id);
}
