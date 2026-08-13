# M2 任务书：API 层（service worker）

## 目标

实现翻译引擎：provider 抽象（Gemini / OpenAI 兼容）、提示词组装（含术语表）、分块、错误分类、指数退避重试、key 轮换、进度/结果消息回传。

## 必读契约

- `SPEC.md` 第 6、7 节
- `src/shared/types.ts`

## 交付物

1. `src/background/settings.ts`：读写 `chrome.storage.local` 的设置（与 `DEFAULT_SETTINGS` 合并）。
2. `src/background/prompt.ts`：`buildPrompt()` 组装 system/user 提示词，规则见 SPEC 7.3。
3. `src/background/providers.ts`：`callProvider()` 分发到 Gemini 或 OpenAI 兼容接口；统一超时（60s）、错误分类（`ProviderCallError.kind`）、响应 JSON 解析与校验。
4. `src/background/translate.ts`：`handleTranslatePage()` 编排——分块（maxCharsPerRequest）、逐块调用、进度（TRANSLATE_PROGRESS）、分块结果（TRANSLATE_CHUNK）、完成（TRANSLATE_DONE）、失败（TRANSLATE_FAILED）；额度类错误把 provider 移到列表尾部并持久化；同标签页重复翻译取消上一轮（cancelled）。
5. `src/background/index.ts`：路由 `TRANSLATE_PAGE` 到编排器。

## 错误分类（SPEC 7.4）

- 429 → `rate_limited`；401 → `auth_failed`；403（quota/insufficient/exhausted）→ `quota_exhausted`，否则 `auth_failed`；5xx → `server_error`；超时 → `timeout`；外部取消 → `cancelled`；解析失败/段数不完整 → `invalid_response`；未配置 key → `config_error`。

## 验收

- `npm run typecheck`、`npm run build` 通过。
- 代码评审：无未处理 Promise、无 key 泄漏进日志、轮换有边界不会死循环。
