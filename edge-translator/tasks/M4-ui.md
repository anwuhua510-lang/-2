# M4 任务书：UI（popup + options）

## 目标

实现用户可见的两个页面：popup（翻译控制）与 options（设置）。

## 必读契约

- `SPEC.md` 第 5 节
- `src/shared/types.ts`、`src/shared/storage.ts`

## 交付物

1. `src/shared/storage.ts`：`getSettings`/`saveSettings`（background/content/popup/options 共用）。
2. `src/popup/`：总开关（masterEnabled）、源/目标语言、当前引擎展示、翻译/恢复按钮、打开设置链接；设置变更即持久化。
3. `src/options/`：provider 有序列表（增删/上移下移/启用、模型、key、自定义 endpoint）；术语表（增删改、示例词表、JSON 导入导出）；高级参数；保存并广播 `SETTINGS_UPDATED`。
4. `src/background/settings.ts`、`src/content/index.ts` 改为复用 `shared/storage.ts`。

## 验收

- `npm run typecheck`、`npm run build` 通过。
- 代码评审：key 输入框为 password 类型；保存有校验与反馈；导入导出格式一致。
