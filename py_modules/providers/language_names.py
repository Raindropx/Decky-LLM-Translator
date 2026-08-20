"""Shared language names for instructions sent to translation models."""

from __future__ import annotations


LANGUAGE_NAMES = {
    "auto": "auto-detect",
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "pt": "Portuguese",
    "nl": "Dutch",
    "pl": "Polish",
    "tr": "Turkish",
    "ro": "Romanian",
    "vi": "Vietnamese",
    "fi": "Finnish",
    "ru": "Russian",
    "uk": "Ukrainian",
    "el": "Greek",
    "th": "Thai",
    "bg": "Bulgarian",
    "ar": "Arabic",
    "hi": "Hindi",
    "id": "Indonesian",
    "ms": "Malay",
    "sv": "Swedish",
    "da": "Danish",
    "no": "Norwegian",
    "cs": "Czech",
    "hu": "Hungarian",
    "he": "Hebrew",
    "hr": "Croatian",
}


def language_name_for_llm(value: str) -> str:
    """Expand built-in codes while preserving custom language definitions verbatim."""
    return LANGUAGE_NAMES.get(value, value)
