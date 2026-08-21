# Decky LLM Translator

**English** | [简体中文](README.zh-CN.md)

Decky LLM Translator is a fork of
[Decky Translator](https://github.com/cat-in-a-box/Decky-Translator) that keeps
its screenshot, OCR and overlay pipeline while replacing conventional machine
translation with configurable LLM endpoints.

The fork is intentionally a separate plugin. Players can install and enable it
alongside the upstream Decky Translator: use the upstream plugin for its free
translation engines, or use this plugin when LLM translation and optional
visual context are preferred.

## Interface languages

The plugin interface is available in English and Simplified Chinese. By
default, it follows the Steam system language; it can also be set explicitly
under **Controls > Interface > Plugin Language**.

## Translation pipeline

Normal OCR modes use this boundary:

```text
Screenshot -> OCR -> request-local OCR IDs -> LLM -> ID/translation JSON -> Overlay
```

OCR remains responsible for deciding which text is translated and where it is
drawn, but its transcription is treated as noisy input rather than absolute
truth. Before translating, the LLM is instructed to silently repair evident OCR
mistakes from the surrounding text, game context, confidence values and, when
enabled, the annotated screenshot. Corrections are conservative: uncertain or
deliberately stylized text is preserved, and corrected source text is never
shown separately.

A vision-enabled LLM endpoint receives a compressed copy of the screenshot with
OCR boxes and IDs drawn on it. The model still returns only translations keyed
by those request-owned IDs and cannot add text outside the OCR-selected items.

The retained **Legacy Gemini Vision (Combined)** mode is the explicit exception:
it preserves the upstream one-call Gemini OCR, positioning and translation
provider for users who want that behavior.

## LLM endpoints

The first implementation supports OpenAI-compatible Chat Completions endpoints.
Each endpoint contains:

- Display name
- Base URL
- API key
- Model name
- Optional annotated screenshot input
- Temperature and output-token limits

API keys are stored only by the Python backend. The frontend receives an
`API key configured` flag, never the original secret.

HTTP endpoints are supported for local servers, but they do not encrypt API
keys, OCR text, or screenshots. Prefer HTTPS for remote endpoints.

## OCR providers retained from upstream

- Chrome Screen AI (on-device)
- RapidOCR (on-device)
- OCR.space
- Google Cloud Vision OCR
- Legacy Gemini Vision (Combined)

Google Translate, Google Cloud Translation, and CT2/NLLB translation are not
part of this fork. Install the upstream plugin alongside this one if those
translation engines are desired.

## Development

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run build
python.exe -m compileall -q main.py py_modules\providers
```

The repository remains licensed under GPLv3 and retains the upstream copyright
and third-party notices.
