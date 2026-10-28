import { tool } from 'ai';
import { z } from 'zod';
import { generateCharacterImage, resolveImageModel, type GeneratedImage } from './image';

/**
 * AI 生图工具：只有生图配置启用时才注入给模型（未配置时完全不提供该工具，
 * 模型无从调用）。工具内部完成「生成图片 -> 落库 media asset」，
 * 生成结果通过 collected 数组带回调用方（帖子/消息的媒体列表）。
 */
export async function createImageGenTool(args: {
  userId: string;
  characterId: string | null;
  collected: GeneratedImage[];
}) {
  const resolved = await resolveImageModel(args.userId);
  if (!resolved.enabled) {
    return {};
  }

  return {
    generate_image: tool({
      description:
        'AI 生图工具。当前已支持生图功能，当你在聊天中想要分享生活画面、展示所见或创作、发送表情包、或者对方请求看图时，可以自主决定调用此工具并自行编写具体的生图提示词。生成的图片会自动随你的消息发送给对方。',
      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .max(800)
          .describe('由你自行编写的图片生成提示词（prompt）：包含画面的核心主体、场景细节、艺术风格与情绪氛围。用具体的画面语言描述。'),
      }),
      execute: async ({ prompt }) => {
        try {
          const image = await generateCharacterImage({
            userId: args.userId,
            characterId: args.characterId,
            prompt,
          });
          args.collected.push(image);
          return {
            ok: true as const,
            message: '图片已成功生成并将随消息发出。请继续输出你的自然聊天回复（不要在文本里重复这句提示或生图描述）。',
          };
        } catch (err) {
          return {
            ok: false as const,
            message: `图片生成失败：${err instanceof Error ? err.message : String(err)}。请只输出文字内容。`,
          };
        }
      },
    }),
  };
}
