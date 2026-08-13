/**
 * edge-ai-translator 共享类型与契约（M0）
 *
 * 本文件是 M1–M5 所有模块之间的唯一类型契约。
 * 修改任何类型前，先更新 SPEC.md 第 5/6 节。
 */

// ========== 设置与存储（chrome.storage.local） ==========

/** 引擎类型 */
export type ProviderKind = 'gemini' | 'openai-compatible';

/** 一个 provider 条目（一个 key 即一条） */
export interface ProviderConfig {
  /** 稳定标识（uuid），用于列表管理 */
  id: string;
  /** 显示名，如 "我的 Gemini" */
  name: string;
  /** 引擎类型 */
  kind: ProviderKind;
  /** 模型名，如 gemini-2.5-flash / llama-3.3-70b-versatile */
  model: string;
  /** 用户自己的 key，仅存本机，不进仓库 */
  apiKey: string;
  /** 自定义 endpoint（代理/转发）；缺省使用内置默认地址 */
  baseUrl?: string;
  /** 是否参与轮换 */
  enabled: boolean;
}

export type SourceLanguage = 'auto' | 'en' | 'ja';
export type TargetLanguage = 'zh-CN' | 'zh-TW';

export interface GlossaryEntry {
  id: string;
  /** 原文词/短语 */
  source: string;
  /** 译文 */
  target: string;
  /** 可选分类，如 科技/游戏/动漫 */
  category?: string;
  note?: string;
}

export interface ProxySettings {
  /** "自定义 endpoint/代理"总开关；具体地址在 ProviderConfig.baseUrl 配置 */
  enabled: boolean;
}

export interface ExtensionSettings {
  version: 1;
  targetLanguage: TargetLanguage;
  sourceLanguage: SourceLanguage;
  /** 有序列表：第一项优先，其余备用；额度用尽自动轮换 */
  providers: ProviderConfig[];
  glossary: GlossaryEntry[];
  /** 总开关：false = 恢复原文并禁止翻译 */
  masterEnabled: boolean;
  autoRetry: boolean;
  maxTextBlocksPerPage: number;
  maxCharsPerRequest: number;
  maxRetries: number;
  proxy: ProxySettings;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  version: 1,
  targetLanguage: 'zh-CN',
  sourceLanguage: 'auto',
  providers: [],
  glossary: [],
  masterEnabled: false,
  autoRetry: true,
  maxTextBlocksPerPage: 500,
  maxCharsPerRequest: 4000,
  maxRetries: 3,
  proxy: { enabled: false },
};

// ========== 翻译请求 / 结果 ==========

export interface TranslationSegment {
  id: string;
  text: string;
}

export interface TranslationRequest {
  providerId: string;
  segments: TranslationSegment[];
  sourceLanguage: SourceLanguage;
  targetLanguage: TargetLanguage;
  glossary: GlossaryEntry[];
}

export type TranslationErrorKind =
  | 'rate_limited' // 429：可等待重试或轮换
  | 'quota_exhausted' // 额度用尽：轮换 key
  | 'auth_failed' // 401/403：key 无效
  | 'config_error' // 未配置可用 key / 配置缺失
  | 'network' // 连接失败
  | 'timeout'
  | 'server_error' // 5xx
  | 'invalid_response'
  | 'cancelled';

export interface TranslationError {
  kind: TranslationErrorKind;
  message: string;
  retryable: boolean;
}

export interface SegmentTranslation {
  id: string;
  text: string;
}

export interface TranslationResult {
  providerId: string;
  segments: SegmentTranslation[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  error?: TranslationError;
}

// ========== 运行时消息协议 ==========
// content script ↔ service worker / popup ↔ content script

/** content script → service worker */
export interface TranslatePageMessage {
  type: 'TRANSLATE_PAGE';
  request: TranslationRequest;
}

/** service worker → content script：单块完成，增量替换 DOM */
export interface TranslateChunkMessage {
  type: 'TRANSLATE_CHUNK';
  segments: SegmentTranslation[];
}

/** service worker → content script：进度 */
export interface TranslateProgressMessage {
  type: 'TRANSLATE_PROGRESS';
  done: number;
  total: number;
  providerName: string;
}

/** service worker → content script：全部完成 */
export interface TranslateDoneMessage {
  type: 'TRANSLATE_DONE';
  result: TranslationResult;
}

/** service worker → content script：不可恢复失败 */
export interface TranslateFailedMessage {
  type: 'TRANSLATE_FAILED';
  error: TranslationError;
}

/** popup → content script：命令 */
export interface PopupCommandMessage {
  type: 'POPUP_COMMAND';
  command: 'translate' | 'restore' | 'get-status';
}

/** content script → popup：当前状态 */
export interface ContentStatusMessage {
  type: 'CONTENT_STATUS';
  translated: boolean;
  progress?: {
    done: number;
    total: number;
  };
  error?: TranslationError;
}

/** service worker → popup / options：设置变更广播 */
export interface SettingsUpdatedMessage {
  type: 'SETTINGS_UPDATED';
  settings: ExtensionSettings;
}

export type RuntimeMessage =
  | TranslatePageMessage
  | TranslateChunkMessage
  | TranslateProgressMessage
  | TranslateDoneMessage
  | TranslateFailedMessage
  | PopupCommandMessage
  | ContentStatusMessage
  | SettingsUpdatedMessage;

// ========== API 默认值（M2 使用） ==========

export const DEFAULT_ENDPOINTS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  'openai-compatible': 'https://api.groq.com/openai/v1',
} as const;

export const DEFAULT_MODELS = {
  gemini: 'gemini-3.6-flash',
  'openai-compatible': 'llama-3.3-70b-versatile',
} as const;
