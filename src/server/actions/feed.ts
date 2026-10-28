'use server';

import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { aiCharacters, comments, communityEvents, mediaAssets, notifications, posts, reactions } from '@/db/schema';
import { requireUserId } from '@/lib/session';
import { enqueueEvent } from '@/server/ai/community/events';
import { maybePulse, processDueEvents, processEvent } from '@/server/ai/community/engine';
import { uploadFeedCover } from '@/server/media';
import { setFeedCover } from '@/server/settings';

const createPostSchema = z.object({
  content: z.string().trim().max(2000, '最多 2000 字'),
});

const MAX_POST_IMAGES = 9;

export async function createPost(formData: FormData) {
  const userId = await requireUserId();
  const parsed = createPostSchema.safeParse({ content: formData.get('content') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '发布失败' };
  }

  // 图片：客户端先上传到 /api/media/upload 拿到 assetId，再随发帖提交（最多 9 张）
  const mediaIds = formData
    .getAll('mediaIds')
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (mediaIds.length > MAX_POST_IMAGES) {
    return { error: `最多上传 ${MAX_POST_IMAGES} 张图片` };
  }
  if (!parsed.data.content && mediaIds.length === 0) {
    return { error: '写点什么或添加图片吧' };
  }

  let mediaJson: string | null = null;
  if (mediaIds.length > 0) {
    const assets = await db
      .select({
        id: mediaAssets.id,
        blobUrl: mediaAssets.blobUrl,
        downloadUrl: mediaAssets.downloadUrl,
        width: mediaAssets.width,
        height: mediaAssets.height,
        mediaType: mediaAssets.mediaType,
        status: mediaAssets.status,
      })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.userId, userId), inArray(mediaAssets.id, mediaIds)));
    const ordered = mediaIds
      .map((id) => assets.find((a) => a.id === id))
      .filter(
        (a): a is (typeof assets)[number] => !!a && a.mediaType === 'image' && a.status === 'ready',
      );
    if (ordered.length === 0) {
      return { error: '图片已失效，请重新上传' };
    }
    mediaJson = JSON.stringify(
      ordered.map((a) => ({
        type: 'image',
        id: a.id,
        url: a.downloadUrl || a.blobUrl,
        width: a.width,
        height: a.height,
      })),
    );
  }

  const postId = crypto.randomUUID();
  await db.insert(posts).values({
    id: postId,
    userId,
    authorType: 'user',
    content: parsed.data.content,
    ...(mediaJson ? { media: mediaJson } : {}),
  });

  // fan out to the AI community engine after the response is sent
  const eventId = await enqueueEvent(userId, 'user_post_created', {
    postId,
    dedupeKey: `post:${postId}`,
  });
  after(async () => {
    await processEvent(eventId).catch(console.error);
  });

  revalidatePath('/feed');
  return { ok: true };
}

export async function toggleLike(postId: string) {
  const userId = await requireUserId();

  const [existing] = await db
    .select({ id: reactions.id })
    .from(reactions)
    .where(
      and(
        eq(reactions.postId, postId),
        eq(reactions.userId, userId),
        eq(reactions.authorType, 'user'),
      ),
    )
    .limit(1);

  if (existing) {
    await db.delete(reactions).where(eq(reactions.id, existing.id));
  } else {
    await db.insert(reactions).values({
      id: crypto.randomUUID(),
      postId,
      userId,
      authorType: 'user',
      type: 'like',
    });
  }
  revalidatePath('/feed');
  revalidatePath(`/post/${postId}`);
  return { liked: !existing };
}

const commentSchema = z.object({
  postId: z.string().min(1),
  content: z.string().trim().min(1, '评论不能为空').max(500, '评论最多 500 字'),
  parentCommentId: z.string().nullable().optional(),
});

export async function addComment(input: z.input<typeof commentSchema>) {
  const userId = await requireUserId();
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '评论失败' };
  }

  const [post] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, parsed.data.postId), eq(posts.userId, userId)))
    .limit(1);
  if (!post) return { error: '动态不存在' };

  const commentId = crypto.randomUUID();
  await db.insert(comments).values({
    id: commentId,
    postId: parsed.data.postId,
    userId,
    authorType: 'user',
    content: parsed.data.content,
    parentCommentId: parsed.data.parentCommentId ?? null,
  });

  // let the AI community react to the comment
  const eventId = await enqueueEvent(userId, 'user_comment_created', {
    postId: parsed.data.postId,
    commentId,
    dedupeKey: `user-comment-event:${commentId}`,
  });
  after(async () => {
    await processEvent(eventId).catch(console.error);
  });

  revalidatePath('/feed');
  revalidatePath(`/post/${parsed.data.postId}`);
  return { ok: true };
}

export async function deletePost(postId: string) {
  const userId = await requireUserId();
  await db.delete(posts).where(and(eq(posts.id, postId), eq(posts.userId, userId)));
  revalidatePath('/feed');
  return { ok: true };
}

export async function markNotificationsRead() {
  const userId = await requireUserId();
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return { ok: true };
}

export async function unreadNotificationCount() {
  const userId = await requireUserId();
  const [{ count }] = await db
    .select({ count: sql<number>`CAST(count(*) AS INTEGER)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return count;
}

export async function getUnreadEventCount() {
  const userId = await requireUserId();
  const [{ count }] = await db
    .select({ count: sql<number>`CAST(count(*) AS INTEGER)` })
    .from(communityEvents)
    .where(and(eq(communityEvents.userId, userId), eq(communityEvents.status, 'pending')));
  return count;
}


export type NotificationItem = {
  id: string;
  type: string;
  content: string;
  read: boolean;
  createdAt: Date;
  conversationId: string | null;
  postId: string | null;
  characterName: string | null;
  characterEmoji: string | null;
  characterColor: string | null;
  characterAvatarUrl: string | null;
};

export async function getRecentNotifications(limit = 10): Promise<NotificationItem[]> {
  const userId = await requireUserId();
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      content: notifications.content,
      read: notifications.read,
      createdAt: notifications.createdAt,
      conversationId: notifications.conversationId,
      postId: notifications.postId,
      characterName: aiCharacters.name,
      characterEmoji: aiCharacters.avatarEmoji,
      characterColor: aiCharacters.avatarColor,
      characterAvatarUrl: aiCharacters.avatarUrl,
    })
    .from(notifications)
    .leftJoin(aiCharacters, eq(notifications.characterId, aiCharacters.id))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows;
}

export async function markSingleNotificationRead(notificationId: string) {
  const userId = await requireUserId();
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
  revalidatePath('/notifications');
  return { ok: true };
}

export async function getFeedNotifications(limit = 20): Promise<NotificationItem[]> {
  const userId = await requireUserId();
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      content: notifications.content,
      read: notifications.read,
      createdAt: notifications.createdAt,
      conversationId: notifications.conversationId,
      postId: notifications.postId,
      characterName: aiCharacters.name,
      characterEmoji: aiCharacters.avatarEmoji,
      characterColor: aiCharacters.avatarColor,
      characterAvatarUrl: aiCharacters.avatarUrl,
    })
    .from(notifications)
    .leftJoin(aiCharacters, eq(notifications.characterId, aiCharacters.id))
    .where(
      and(
        eq(notifications.userId, userId),
        or(
          inArray(notifications.type, ['comment', 'like']),
          isNotNull(notifications.postId),
        ),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows;
}

export async function getUnreadFeedNotificationCount(): Promise<number> {
  const userId = await requireUserId();
  const [{ count }] = await db
    .select({ count: sql<number>`CAST(count(*) AS INTEGER)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.read, false),
        or(
          inArray(notifications.type, ['comment', 'like']),
          isNotNull(notifications.postId),
        ),
      ),
    );
  return count;
}

export async function markFeedNotificationsRead() {
  const userId = await requireUserId();
  await db
    .update(notifications)
    .set({ read: true })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.read, false),
        or(
          inArray(notifications.type, ['comment', 'like']),
          isNotNull(notifications.postId),
        ),
      ),
    );
  revalidatePath('/feed');
  return { ok: true };
}

export async function triggerFeedPulseAction() {
  const userId = await requireUserId();
  try {
    await maybePulse(userId);
    await processDueEvents(userId, 3);
  } catch (err) {
    console.error('[feed] manual pulse failed', err);
  }
  revalidatePath('/feed');
  return { ok: true };
}

export async function uploadFeedCoverAction(
  formData: FormData,
): Promise<{ ok: true; coverUrl: string; assetId: string } | { ok: false; error: string }> {
  const userId = await requireUserId();
  const file = formData.get('file') as File | null;

  if (!file) {
    return { ok: false, error: '请选择要上传的背景图片' };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const res = await uploadFeedCover({
    userId,
    buffer,
    originalFilename: file.name || 'cover.jpg',
    mimeType: file.type || 'image/jpeg',
  });

  if (res.ok) {
    revalidatePath('/feed');
  }

  return res;
}

export async function updateFeedCoverUrlAction(coverUrl: string | null) {
  const userId = await requireUserId();
  await setFeedCover(userId, coverUrl);
  revalidatePath('/feed');
  return { ok: true };
}