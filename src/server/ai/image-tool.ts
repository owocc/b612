import { tool } from 'ai';
import { z } from 'zod';
import {
  generateCharacterImage,
  isReferenceUnsupportedError,
  resolveImageModel,
  type GeneratedImage,
} from './image';
import {
  APPEARANCE_REF_KINDS,
  MAX_APPEARANCE_REFERENCES,
  selectReferenceImages,
  type AppearanceRefKind,
  type CharacterAppearance,
} from './character-appearance';

/**
 * 出镜生图的 prompt 前缀：即使服务商不支持参考图，也能靠文字描述保持人物一致性。
 * 只描述角色外观，不包含任何资产 URL。
 */
function appearancePromptPrefix(appearance: CharacterAppearance): string {
  const parts: string[] = [`Character identity: this is ${appearance.characterName}.`];
  if (appearance.description) {
    parts.push(`Appearance: ${appearance.description}.`);
  }
  if (appearance.style) {
    parts.push(`Art style: ${appearance.style}.`);
  }
  parts.push(
    'Keep the same face shape, facial features, hairstyle and hair color, body type and outfit design as described; do not change gender, age or art style.',
  );
  return parts.join(' ');
}

function sanitizeRefs(refs: unknown): AppearanceRefKind[] {
  if (!Array.isArray(refs)) return [];
  return refs.filter(
    (ref): ref is AppearanceRefKind =>
      typeof ref === 'string' && (APPEARANCE_REF_KINDS as readonly string[]).includes(ref),
  );
}

/**
 * 决策层：把模型的「是否出镜 + 选哪些视角」翻译成最终 prompt 与参考图。
 * 纯函数，便于单测覆盖四种分支。
 * - include_self=false：不传参考图、不插外观描述；
 * - include_self=true：前置外观描述 + 只取已启用资产（缺失/无效自动跳过）。
 */
export function resolveImageRequest(args: {
  prompt: string;
  includeSelf?: boolean | null;
  appearanceRefs?: unknown;
  appearance: CharacterAppearance | null;
}): { prompt: string; referenceImages: string[] } {
  const { appearance } = args;
  const wantsSelf = args.includeSelf === true && !!appearance;
  if (!wantsSelf) return { prompt: args.prompt, referenceImages: [] };
  return {
    prompt: `${appearancePromptPrefix(appearance)}\n\n${args.prompt}`,
    referenceImages: selectReferenceImages(appearance.assets, sanitizeRefs(args.appearanceRefs)),
  };
}

/**
 * AI 生图工具：只有生图配置启用时才注入给模型（未配置时完全不提供该工具，
 * 模型无从调用）。工具内部完成「生成图片 -> 落库 media asset」，
 * 生成结果通过 collected 数组带回调用方（帖子/消息的媒体列表）。
 *
 * Stage 4：模型自主决定本次画面是否包含自身形象（include_self），
 * 决定出镜时按 appearance_refs 装配「已启用」角色资产作为多图参考。
 */
export async function createImageGenTool(args: {
  userId: string;
  characterId: string | null;
  collected: GeneratedImage[];
  /** 装配好的角色形象；不传则内部加载（characterId 为空时视为无形象） */
  appearance?: CharacterAppearance | null;
}) {
  const resolved = await resolveImageModel(args.userId);
  if (!resolved.enabled) {
    return {};
  }

  const appearance = args.appearance ?? null;
  const hasReferences = !!appearance && appearance.assets.length > 0;

  const selfHint = hasReferences
    ? '若画面里出现你本人，把 include_self 设为 true，系统会自动带上你已启用的形象参考图，人物长相会与设定集保持一致。'
    : '若画面里出现你本人，把 include_self 设为 true；当前没有已启用的形象参考图，会改用你的外观文字描述保持一致。';

  return {
    generate_image: tool({
      description: `AI 生图工具。当前已支持生图功能，当你在聊天中想要分享生活画面、展示所见或创作、发送表情包、或者对方请求看图时，可以自主决定调用此工具并自行编写具体的生图提示词。生成的图片会自动随你的消息发送给对方。
是否出镜由你自主判断：结合对话语境、情绪氛围、用户意图和你的性格，决定画面里要不要有你自己——不要机械地每次都出镜，也不要一律回避；对方明确要看你时应当出镜。${selfHint}`,
      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .max(800)
          .describe('由你自行编写的图片生成提示词（prompt）：包含画面的核心主体、场景细节、艺术风格与情绪氛围。用具体的画面语言描述。'),
        include_self: z
          .boolean()
          .optional()
          .default(false)
          .describe('本次画面是否需要出现你本人。true = 出镜（自动带入你的形象参考图与外观描述）；false = 纯景物 / 食物 / 他人，不带任何角色参考。'),
        appearance_refs: z
          .array(z.enum(APPEARANCE_REF_KINDS))
          .max(MAX_APPEARANCE_REFERENCES)
          .nullable()
          .optional()
          .describe('仅 include_self=true 时有效：选择作为参考的视角（base 基础形象 / full_body 全身图 / three_view 三视图 / detail_face 脸部特写 / detail_outfit 服饰特写）。不填默认 base + full_body。'),
      }),
      execute: async ({ prompt, include_self, appearance_refs }) => {
        const { prompt: finalPrompt, referenceImages } = resolveImageRequest({
          prompt,
          includeSelf: include_self,
          appearanceRefs: appearance_refs,
          appearance,
        });

        try {
          const image = await generateCharacterImage({
            userId: args.userId,
            characterId: args.characterId,
            prompt: finalPrompt,
            ...(referenceImages.length > 0 ? { referenceImages } : {}),
          });
          args.collected.push(image);
          return {
            ok: true as const,
            message: '图片已成功生成并将随消息发出。请继续输出你的自然聊天回复（不要在文本里重复这句提示或生图描述）。',
          };
        } catch (err) {
          // 模型不支持图生图时降级：去掉参考图重试一次，文字外观描述仍在 prompt 里
          if (referenceImages.length > 0 && isReferenceUnsupportedError(err)) {
            console.warn('[image-tool] 当前模型不支持参考图，降级为纯文本生图');
            try {
              const fallback = await generateCharacterImage({
                userId: args.userId,
                characterId: args.characterId,
                prompt: finalPrompt,
              });
              args.collected.push(fallback);
              return {
                ok: true as const,
                message:
                  '图片已成功生成并将随消息发出（当前模型不支持参考图，已按你的外观描述生成）。请继续输出你的自然聊天回复。',
              };
            } catch (retryErr) {
              return {
                ok: false as const,
                message: `图片生成失败：${retryErr instanceof Error ? retryErr.message : String(retryErr)}。请只输出文字内容。`,
              };
            }
          }
          return {
            ok: false as const,
            message: `图片生成失败：${err instanceof Error ? err.message : String(err)}。请只输出文字内容。`,
          };
        }
      },
    }),
  };
}
