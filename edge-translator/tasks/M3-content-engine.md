# M3 任务书：页面翻译引擎（content script）

## 目标

实现整页翻译的页面侧逻辑：提取可见文本块、发送 `TRANSLATE_PAGE`、接收分块结果并替换 DOM、支持一键恢复原文、页内进度条。

## 必读契约

- `SPEC.md` 第 6、8 节
- `src/shared/types.ts`

## 交付物

1. `src/content/extract.ts`：`extractBlocks()` —— TreeWalker 提取可见文本节点，跳过 `script/style/noscript/svg/math/code/pre/textarea/select/[hidden]/[contenteditable]` 与隐藏/零尺寸元素；同父相邻文本节点合并为一个块；按 `maxTextBlocksPerPage` 截断并返回 `truncated`。
2. `src/content/ui.ts`：页内悬浮进度条（进度/完成/失败/恢复按钮），样式带 `eat-` 前缀避免污染页面。
3. `src/content/index.ts`：消息接线——`POPUP_COMMAND`（translate/restore/get-status）；`TRANSLATE_CHUNK` 增量替换（保留结构，只改文本节点值）；`TRANSLATE_PROGRESS`/`TRANSLATE_DONE`/`TRANSLATE_FAILED`；总开关关闭时不翻译并恢复原文；重复点击翻译忽略。

## 验收

- `npm run typecheck`、`npm run build` 通过。
- 代码评审：不修改链接地址、不破坏 DOM 结构、恢复逻辑与替换完全可逆。
