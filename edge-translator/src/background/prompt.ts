import type {
  GlossaryEntry,
  SourceLanguage,
  TargetLanguage,
  TranslationSegment,
} from '../shared/types';

const LANGUAGE_NAMES: Record<SourceLanguage | TargetLanguage, string> = {
  auto: '自动检测（可能为英语或日语）',
  en: '英语',
  ja: '日语',
  'zh-CN': '简体中文',
  'zh-TW': '繁体中文',
};

export interface BuiltPrompt {
  system: string;
  user: string;
}

export function buildPrompt(input: {
  segments: TranslationSegment[];
  sourceLanguage: SourceLanguage;
  targetLanguage: TargetLanguage;
  glossary: GlossaryEntry[];
}): BuiltPrompt {
  const { segments, sourceLanguage, targetLanguage, glossary } = input;

  const glossaryLines = glossary
    .filter((entry) => entry.source.trim() !== '' && entry.target.trim() !== '')
    .map(
      (entry, index) =>
        `${index + 1}. "${entry.source}" → "${entry.target}"${
          entry.category ? `（${entry.category}）` : ''
        }`,
    )
    .join('\n');

  const system = [
    `你是一名专业翻译。请把用户提供的 JSON 数组中的每段文本，从「${LANGUAGE_NAMES[sourceLanguage]}」翻译成「${LANGUAGE_NAMES[targetLanguage]}」。`,
    '规则：',
    '1. 严格按输入顺序输出 JSON 数组，格式为 [{"id":"...","text":"..."}]，输出条目必须与输入完全一致，不得省略、合并或新增条目；只输出 JSON，不要输出任何其他内容。',
    '2. 代码、链接地址、数字、专有名词、变量名、文件名不得翻译或改动。',
    '3. 保留原文的换行与空行。',
    glossaryLines.length > 0
      ? '4. 必须遵守以下术语表（原文出现对应词时，必须使用指定译文）：\n' + glossaryLines
      : '4. 无特殊术语要求。',
  ].join('\n');

  const user = JSON.stringify(
    segments.map((segment) => ({ id: segment.id, text: segment.text })),
  );

  return { system, user };
}
