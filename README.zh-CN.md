# Decky LLM Translator

[English](README.md) | **简体中文**

Decky LLM Translator 是 [Decky Translator](https://github.com/cat-in-a-box/Decky-Translator)
的一个分支。它保留了原项目的截图、OCR 与画面叠加流程，并将传统机器翻译替换为可配置的
大语言模型（LLM）端点。

本分支有意作为独立插件维护。玩家可以将它与上游 Decky Translator 同时安装并启用：需要
免费翻译引擎时使用上游插件，需要 LLM 翻译和可选视觉上下文时使用本插件。

## 界面语言

插件界面支持英文与简体中文。默认跟随 Steam 系统语言，也可以在
**控制 > 界面 > 插件语言** 中手动选择。

## 翻译流程

常规 OCR 模式采用以下流程：

```text
截图 -> OCR -> 当前请求专属的 OCR ID -> LLM -> ID/译文 JSON -> 画面叠加
```

OCR 仍然负责确定要翻译哪些文本及其显示位置，但识别结果会被视为可能含有噪声的输入，而非
绝对准确的文本。翻译前，系统会指示 LLM 结合相邻文本、游戏上下文、置信度，以及启用视觉
输入时的标注截图，静默修正明显的 OCR 错误。修正策略保持保守：不确定或有意使用特殊拼写的
文本会予以保留，修正后的源文本也不会单独显示。

启用视觉功能的 LLM 端点会收到一份压缩截图，其中绘有 OCR 文本框及对应 ID。模型仍只能
返回以本次请求 ID 为键的译文，无法添加 OCR 未选中的文本。

保留的 **旧版 Gemini Vision（组合模式）** 是明确的例外：它继续使用上游的一次调用方案，
由 Gemini 同时完成 OCR、定位和翻译，供希望保留该行为的用户使用。

## LLM 端点

当前实现支持兼容 OpenAI Chat Completions API 的端点。每个端点包含：

- 显示名称
- Base URL
- API 密钥
- 模型名称
- 是否输入标注截图
- 温度与最大输出 Token 数

API 密钥仅由 Python 后端保存。前端只会收到“已配置 API 密钥”的状态标记，绝不会收到原始
密钥。

本地服务器可以使用 HTTP 端点，但 HTTP 不会加密 API 密钥、OCR 文本或截图。远程端点请
优先使用 HTTPS。

## 保留的上游 OCR 提供方

- Chrome Screen AI（设备本地）
- RapidOCR（设备本地）
- OCR.space
- Google Cloud Vision OCR
- 旧版 Gemini Vision（组合模式）

本分支不包含 Google Translate、Google Cloud Translation 和 CT2/NLLB 翻译。如需这些
翻译引擎，请同时安装上游插件。

## 开发

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run build
python.exe -m compileall -q main.py py_modules\providers
```

本仓库继续采用 GPLv3 许可证，并保留上游版权声明及第三方软件声明。
