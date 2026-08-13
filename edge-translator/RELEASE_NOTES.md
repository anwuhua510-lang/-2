# v0.1.3

Edge AI 网页翻译扩展（英语 / 日语 → 中文）

## 功能

- 整页翻译，手动触发，默认不自动翻译
- 多引擎：Groq（推荐）/ Gemini / 任意 OpenAI 兼容接口，额度用尽自动轮换
- 术语表：手动维护 + JSON 导入导出 + 示例词表
- 页面翻译缓存：显示原文后可一键"显示翻译"复用缓存，不消耗 API 额度
- 翻译进度条、完成自动淡出、一键显示原文
- 引擎"测试连接"、自定义 endpoint

## 安装

- **crx**：Edge 打开 `edge://extensions`，开启"开发人员模式"，把 crx 文件拖入页面安装
- **zip**：解压后，`edge://extensions` 开启"开发人员模式"，加载解压缩的扩展，选择解压出的目录

## 首次使用

打开扩展设置，添加自己的 API key：

- Groq：https://console.groq.com 免费注册，模型 `llama-3.3-70b-versatile`
- 或 Gemini：https://aistudio.google.com 免费 key，模型 `gemini-3.6-flash`（部分地区可能被拒）

> 分发包不含任何 API key，每个用户需在设置中填写自己的 key。
