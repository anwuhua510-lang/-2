# M1 任务书：工程脚手架

> 说明：本任务书由主代理（/root）编写，原计划派发给子代理，因子代理消息通道故障改由主代理直接执行。任务书保留在仓库中，便于审查与复用。

## 目标

在 `C:\Users\anwuh\Desktop\git\edge-translator` 下搭建 Edge 浏览器扩展（Manifest V3、TypeScript + Vite）工程脚手架，构建产物可被 Edge 直接加载。

## 必读契约（禁止修改）

- `edge-translator/SPEC.md`
- `edge-translator/src/shared/types.ts`

## 交付物

1. `package.json`：name=edge-ai-translator，private，scripts 含 dev/build/typecheck/zip。
2. `src/manifest.json`：MV3；name "Edge AI 网页翻译"；version 0.1.0；default_popup 指向 popup；background service_worker（type module）；content_scripts 匹配 `<all_urls>`（document_idle）；options_page；permissions: storage/activeTab/scripting；host_permissions: `https://generativelanguage.googleapis.com/*`、`https://api.groq.com/*`；icons 16/32/48/128。
3. `src/background/index.ts`：骨架，监听 runtime.onMessage 并回显消息类型。
4. `src/content/index.ts`：可编译骨架（M3 再实现提取与替换）。
5. `src/popup/index.html` + `popup.ts` + `popup.css`：占位 UI（标题 + 翻译按钮）。
6. `src/options/index.html` + `options.ts` + `options.css`：占位页。
7. `src/shared/types.ts`：保持不动。
8. `public/icons/16.png,32.png,48.png,128.png`：纯色占位图标（脚本生成）。
9. `tsconfig.json`：strict、target ES2022、module ESNext、moduleResolution bundler、lib DOM+ES2022。
10. `README.md`：本地安装方法（edge://extensions → 开发人员模式 → 加载 dist）、npm 脚本说明、自定义 endpoint 需在 manifest 的 host_permissions 中手动加域名的说明。
11. `scripts/gen-icons.mjs`、`scripts/zip.mjs`：图标生成与 zip 打包脚本。

## 验收标准

- `npm install`、`npm run typecheck`、`npm run build`、`npm run zip` 全部成功。
- `dist/` 包含 manifest.json、background.js、content.js、popup/index.html、options/index.html、icons/。
- 构建产物在 Edge 中可加载（结构层面），弹出 popup 显示占位 UI。

## 约束

- 不运行 git 命令（提交由主代理负责）。
- 不修改 SPEC.md、types.ts。
