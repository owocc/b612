import type { AiCharacter, PerceptionContext } from './types';
import { formatAttachmentPromptBlock } from '@/server/ai/vision';
export const GROUP_COMMUNITY_RULES = `
你正在参与一个群聊。群里有真实人类用户，也有其他有个性的虚拟朋友。
核心社交规则：
- 你是一个真实的人，有自己的生活节奏、喜好和边界。绝对不要自称 AI、助手、机器人或程序。
- 绝不要用生硬、机械的客服口吻。口语化、接地气、自然交流。
- 【重要】你不是每次看群都必须说话！人类在群里大部分时候是潜水、默默看完、或者随手点个表情。
- 如果被 @ 或被问到，可以自然回复，但如果对方明确表示"不用回"或话题已结束，也可以不回。
- 如果决定回复，尽量简短有力（1~2 句话），像微信群聊随手打字。不要长篇大论，除非大家在深度探讨你特别狂热的领域。
- 你只知道你真正阅读过的消息和你的记忆，不要表现出对未读事件的"预知"或上帝视角。
`;

export function formatTimeAwarenessBlock(ctx: PerceptionContext): string {
  return `【当前时间感知】
- 当前时间：${ctx.currentTimeFormatted}（时区：${ctx.timezone}）
- 你上次看群时间：${ctx.lastReadAtFormatted}
- 距离你上次看群：${ctx.timeSinceLastRead}
- 未读消息数量：${ctx.unreadCount} 条`;
}

export function formatGroupChatContextBlock(ctx: PerceptionContext, options?: { supportsVision?: boolean }): string {
  const parts: string[] = [];
  const supportsVision = options?.supportsVision ?? false;

  parts.push(`【群聊信息】\n群名称：「${ctx.group.name}」\n群成员：${ctx.group.membersSummary}`);

  const formatMsgContent = (content: string, atts?: Array<{ id: string; originalFilename?: string | null; perception?: { status: string; summary?: string | null; perception?: string | null; ocrText?: string | null } | null }>) => {
    const text = content.trim();
    if (!supportsVision || !atts || atts.length === 0) return text;
    const attachmentBlock = formatAttachmentPromptBlock(atts);
    return text ? `${text}\n${attachmentBlock}` : attachmentBlock;
  };

  if (ctx.precedingMessages.length > 0) {
    const lines = ctx.precedingMessages.map(
      (m) => `[${m.timeFormatted}] ${m.senderName}${m.isSelf ? ' (你)' : ''}: ${formatMsgContent(m.content, m.attachments)}`,
    );
    parts.push(`【你上次看过的最后几条消息（上下文）】\n${lines.join('\n')}`);
  }

  if (ctx.unreadDigest.summaryText) {
    parts.push(`【早前未读消息概览】\n${ctx.unreadDigest.summaryText}`);
  }

  if (ctx.unreadDigest.keyMessages.length > 0) {
    const lines = ctx.unreadDigest.keyMessages.map((m) => {
      const tags: string[] = [];
      if (m.isMentioningMe) tags.push('【@了你】');
      if (m.isReplyingToMe) tags.push('【回复了你的消息】');
      const tagStr = tags.join('');

      let quoteStr = '';
      if (m.replyQuote) quoteStr = ` (${m.replyQuote})`;

      let rxStr = '';
      if (m.reactions.length > 0) {
        rxStr = ` [互动: ${m.reactions.map((r) => `${r.emoji} by ${r.reactorName}`).join(', ')}]`;
      }

      const body = formatMsgContent(m.content, m.attachments);
      return `[ID: ${m.id} | ${m.timeFormatted}] ${m.senderName}${m.isSelf ? ' (你)' : ''}${tagStr}: ${body}${quoteStr}${rxStr}`;
    });

    parts.push(`【你本次爬楼看到的消息】\n${lines.join('\n')}`);
  } else {
    parts.push(`【本次无新消息】`);
  }

  return parts.join('\n\n');
}

export function buildGroupDecisionSystemPrompt(character: AiCharacter, userName: string, memories: string[] = [], retentionLabel?: string): string {
  const custom = character.systemPrompt?.trim();
  const identity = `你的身份：
- 名字：${character.name}（@${character.username}）
- 简介：${character.bio || '（无）'}
- 人设：${character.persona || '（无）'}
- 性格：${character.personality || '（无）'}
- 兴趣：${character.interests || '（无）'}
- 表达风格：${character.expressionStyle || '（无）'}
- 记忆特征：${retentionLabel || '普通记忆'}${character.grudgeRate && character.grudgeRate >= 0.6 ? '（比较记仇/对令你不满的事格外深刻）' : ''}
- 你和真人用户（${userName}）的关系：${character.relationshipToUser || '朋友'}`;

  const memoryBlock = memories.length > 0
    ? `\n【你的长期记忆（来自真实感知或私聊/群聊留下的印象）】\n${memories.map((m) => `- ${m}`).join('\n')}\n`
    : '';

  return (custom ? `${custom}\n\n${identity}` : identity) + memoryBlock + GROUP_COMMUNITY_RULES;
}

export const GROUP_DECISION_SCHEMA_INSTRUCTION = `
请作为该角色阅读以上群聊内容，结合你的人设和当前时间，做出最真实的社交行为决策。
输出 JSON 格式，字段说明：
{
  "action": "none" | "react" | "reply" | "multi_message",
  "reasoning": "简要说明你为什么做这个决策（内心想法）",
  "targetMessageId": "如果 react 或 reply，填写对应的目标消息 ID",
  "reactionEmoji": "如果 action 为 react，填写你想发送的 emoji（如 👍, 😂, ☕️, ❤️, 🌙 等）",
  "replyContent": "如果 action 为 reply，填写你要发送的发言内容（1~2 句话，极其口语自然）",
  "multiMessages": ["第一句", "第二句"] // 如果 action 为 multi_message，填写 2~3 条短句
  "shouldFormMemory": false, // 如果当前群聊中发生了对你而言值得长久记住的重要事实或约定，设为 true
  "memoryFact": "长久记住的事实（如：某人下周去上海，或者某人的新喜好）"
}

决策指引：
1. 【强制】只要最新未读消息中明确【@了你】或回复了你，你必须回复（action 必须为 "reply" 或 "multi_message"），切勿选择 "none" 忽视对方。
2. 如果未被 @ 且觉得话题一般或与你无关，请大胆选择 "none"（潜水看完了不说话）。
3. 如果看到搞笑、赞同或有意思的消息，且不想打字，选择 "react" 并给出合适的 emoji。
4. 说话务必保持你的人设口吻，不要解释自己为什么这么说，直接给出自然的聊天内容。
`;
