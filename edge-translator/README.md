# Edge AI 网页翻译扩展

通过免费 AI 模型实现高质量整页网页翻译（英语/日语 → 中文）。Manifest V3 + TypeScript + Vite。

> 完整规格见 [SPEC.md](./SPEC.md)。

## 本地安装（开发模式）

1. `npm install`
2. `npm run build`
3. 打开 Edge，访问 `edge://extensions`
4. 打开左下角"开发人员模式"
5. 点击"加载解压缩的扩展"，选择本目录下的 `dist` 文件夹

## npm 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式（Vite + HMR） |
| `npm run build` | 构建到 `dist/` |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run zip` | 把 `dist/` 打包为 `edge-translator.zip` |
| `npm run icons` | 重新生成占位图标 |

## 给朋友的分发包

执行 `npm run zip`，把 `edge-translator.zip` 发给朋友。对方解压后按上面的第 3–5 步加载解压出的文件夹即可。**分发包不含任何 API key**，每个用户需要在扩展设置页填入自己的 key（M4 实现）。

## 自定义 API endpoint（代理/转发）

扩展默认只允许访问两个域名：`generativelanguage.googleapis.com` 与 `api.groq.com`。如果你使用自定义 endpoint，需要手动把它加入 `src/manifest.json` 的 `host_permissions`，然后重新 `npm run build`：

```json
"host_permissions": [
  "https://generativelanguage.googleapis.com/*",
  "https://api.groq.com/*",
  "https://你的自定义域名/*"
]
```

## 常见问题

### Gemini 报 403 "Your project has been denied access"

Google 可能因账号、地区或代理出口 IP 拒绝访问（新注册账号或代理出口地区不受支持时常见），插件侧无法修复。

解决办法：改用 OpenAI 兼容引擎（如 Groq）作为主力——

1. 到 [console.groq.com](https://console.groq.com) 免费注册并创建一个 API key（无需信用卡）。
2. 扩展设置 → 添加"OpenAI 兼容"引擎：模型填 `llama-3.3-70b-versatile`，endpoint 留空（默认 `https://api.groq.com/openai/v1`），填入 key。
3. 点"测试连接"确认，然后把它移到列表第一位作为默认引擎。

Gemini 引擎可以保留，等 Google 放行后自动作为备用。

## 目录结构

```text
edge-translator/
  src/
    manifest.json        # MV3 清单
    shared/types.ts      # 共享类型契约（M0）
    background/          # Service Worker（M2：API 层）
    content/             # Content Script（M3：页面翻译引擎）
    popup/               # Popup（M4：控制面板）
    options/             # Options（M4：设置页）
  public/icons/          # 扩展图标
  scripts/               # 构建辅助脚本
  tasks/                 # 模块任务书
  SPEC.md                # 项目规格
```
