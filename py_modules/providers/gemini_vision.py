# providers/gemini_vision.py
# Gemini Vision provider -- combined OCR + translation in a single API call

import base64
import json
import logging
import re
import struct
from typing import List, Optional

import requests

from .base import (
    OCRProvider,
    ProviderType,
    TextRegion,
    NetworkError,
    ApiKeyError,
    RateLimitError,
    classify_google_error,
)

logger = logging.getLogger(__name__)

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL = "gemini-2.5-flash"
REQUEST_TIMEOUT = 30

# Language code to natural name for the prompt
LANG_NAMES = {
    "auto": "auto-detect",
    "en": "English", "ja": "Japanese", "ko": "Korean",
    "zh-CN": "Simplified Chinese", "zh-TW": "Traditional Chinese",
    "de": "German", "fr": "French", "es": "Spanish",
    "it": "Italian", "pt": "Portuguese", "nl": "Dutch",
    "pl": "Polish", "tr": "Turkish", "ro": "Romanian",
    "vi": "Vietnamese", "fi": "Finnish", "ru": "Russian",
    "uk": "Ukrainian", "el": "Greek", "th": "Thai",
    "bg": "Bulgarian", "ar": "Arabic", "hi": "Hindi",
    "id": "Indonesian", "ms": "Malay", "sv": "Swedish",
    "da": "Danish", "no": "Norwegian", "cs": "Czech",
    "hu": "Hungarian", "he": "Hebrew", "hr": "Croatian",
}


def _get_png_dimensions(data: bytes) -> tuple:
    """Extract width and height from a PNG file header."""
    if len(data) < 24 or data[:4] != b'\x89PNG':
        return 0, 0
    width, height = struct.unpack('>II', data[16:24])
    return width, height


def _parse_json_response(text: str) -> Optional[list]:
    """
    Try to extract a JSON array from Gemini's response text.
    Three-tier parsing: direct, markdown-stripped, bracket-matched.
    """
    cleaned = text.strip()

    # Strip thinking tags
    cleaned = re.sub(r'<think>.*?</think>', '', cleaned, flags=re.DOTALL)
    cleaned = re.sub(r'<reasoning>.*?</reasoning>', '', cleaned, flags=re.DOTALL)
    cleaned = cleaned.strip()

    # Tier 1: direct parse
    try:
        result = json.loads(cleaned)
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "regions" in result:
            return result["regions"]
    except json.JSONDecodeError:
        pass

    # Tier 2: strip markdown code fences
    md_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', cleaned, re.DOTALL)
    if md_match:
        try:
            result = json.loads(md_match.group(1).strip())
            if isinstance(result, list):
                return result
            if isinstance(result, dict) and "regions" in result:
                return result["regions"]
        except json.JSONDecodeError:
            pass

    # Tier 3: find the outermost [...] by bracket matching
    start = cleaned.find('[')
    if start != -1:
        depth = 0
        for i in range(start, len(cleaned)):
            if cleaned[i] == '[':
                depth += 1
            elif cleaned[i] == ']':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(cleaned[start:i + 1])
                    except json.JSONDecodeError:
                        break

    # Tier 4: truncated response recovery -- find all complete {...} objects
    # inside the outermost array, even if the array itself isn't closed
    if start != -1:
        regions = []
        obj_depth = 0
        obj_start = -1
        for i in range(start + 1, len(cleaned)):
            if cleaned[i] == '{':
                if obj_depth == 0:
                    obj_start = i
                obj_depth += 1
            elif cleaned[i] == '}':
                obj_depth -= 1
                if obj_depth == 0 and obj_start != -1:
                    try:
                        obj = json.loads(cleaned[obj_start:i + 1])
                        regions.append(obj)
                    except json.JSONDecodeError:
                        pass
                    obj_start = -1
        if regions:
            logger.warning(f"Recovered {len(regions)} regions from truncated response")
            return regions

    logger.warning("Failed to parse JSON from Gemini response")
    logger.debug(f"Response text: {cleaned[:500]}")
    return None


def _validate_region(region: dict) -> bool:
    """Check that a region dict has the required fields."""
    if not isinstance(region, dict):
        return False
    if "text" not in region or "box_2d" not in region:
        return False
    box = region["box_2d"]
    if not isinstance(box, list) or len(box) != 4:
        return False
    return all(isinstance(v, (int, float)) for v in box)


class GeminiVisionProvider(OCRProvider):
    """
    Uses Gemini Vision to detect and translate text in screenshots
    in a single API call. Returns TextRegion objects with translated_text set.
    """

    def __init__(self, api_key: str = "", model: str = DEFAULT_MODEL):
        self._api_key = api_key
        self._model = model
        self._target_language = "en"

    def set_api_key(self, api_key: str) -> None:
        self._api_key = api_key

    def set_target_language(self, target_lang: str) -> None:
        self._target_language = target_lang

    @property
    def name(self) -> str:
        return "Gemini Vision"

    @property
    def provider_type(self) -> ProviderType:
        return ProviderType.GEMINI_VISION

    def is_available(self, language: str = "auto") -> bool:
        return bool(self._api_key)

    def get_supported_languages(self) -> List[str]:
        return list(LANG_NAMES.keys())

    def _build_system_instruction(self) -> str:
        return (
            "You detect and translate text in game screenshots. "
            "For each text region, return its box_2d as [ymin, xmin, ymax, xmax] in normalized 0-1000 coordinates. "
            "Return a JSON array covering every readable text region in the image."
        )

    def _build_prompt(self, source_lang: str, target_lang: str) -> str:
        tgt_name = LANG_NAMES.get(target_lang, target_lang)

        source_hint = ""
        if source_lang and source_lang != "auto":
            src_name = LANG_NAMES.get(source_lang, source_lang)
            source_hint = f" The source language is {src_name}."

        prompt = (
            f"Detect the 2D bounding boxes of all visible text in this screenshot.\n"
            f"For each text region return: the original text, its translation to {tgt_name}, "
            f"and the box_2d coordinates.{source_hint}\n\n"
            f"Grouping rules:\n"
            f"- Merge text that shares the same font size, color, and belongs to the same visual block (e.g. a dialog box, tooltip, or paragraph).\n"
            f"- Keep text separate when it differs in font size, color, or visual style, even if spatially close.\n"
            f"- Each menu item, button label, stat value, or HUD element should be its own region.\n\n"
            f"If the text is already in {tgt_name}, set translated_text to the original text."
        )
        return prompt

    def _call_api(self, image_data: bytes, prompt: str) -> str:
        url = f"{GEMINI_API_URL}/{self._model}:generateContent?key={self._api_key}"

        image_b64 = base64.b64encode(image_data).decode('utf-8')

        payload = {
            "system_instruction": {
                "parts": [{"text": self._build_system_instruction()}]
            },
            "contents": [{
                "parts": [
                    {
                        "inline_data": {
                            "mime_type": "image/png",
                            "data": image_b64
                        }
                    },
                    {"text": prompt},
                ]
            }],
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": 32768,
                "thinkingConfig": {
                    "thinkingBudget": 0,
                },
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "text": {"type": "STRING"},
                            "translated_text": {"type": "STRING"},
                            "box_2d": {
                                "type": "ARRAY",
                                "items": {"type": "NUMBER"},
                            },
                        },
                        "required": ["text", "translated_text", "box_2d"],
                    },
                },
            }
        }

        try:
            response = requests.post(
                url,
                json=payload,
                timeout=REQUEST_TIMEOUT,
                headers={"Content-Type": "application/json"}
            )
        except requests.ConnectionError as e:
            raise NetworkError(f"Cannot reach Gemini API: {e}")
        except requests.Timeout:
            raise NetworkError("Gemini API request timed out")

        if response.status_code == 400:
            try:
                body = response.json()
            except Exception:
                body = {}
            error_msg = body.get("error", {}).get("message", response.text[:200])
            if "API_KEY_INVALID" in str(error_msg) or "API key" in str(error_msg):
                raise ApiKeyError(f"Invalid Gemini API key: {error_msg}")
            raise NetworkError(f"Gemini API error (400): {error_msg}")
        elif response.status_code == 401 or response.status_code == 403:
            raise ApiKeyError("Invalid or unauthorized Gemini API key")
        elif response.status_code == 429:
            raise RateLimitError("Gemini API rate limit exceeded. Free tier: 15 req/min, 1000 req/day")
        elif response.status_code != 200:
            raise NetworkError(f"Gemini API error ({response.status_code}): {response.text[:200]}")

        result = response.json()

        usage = result.get("usageMetadata") or {}
        if usage:
            logger.info(
                f"Gemini tokens: prompt={usage.get('promptTokenCount', '?')}, "
                f"completion={usage.get('candidatesTokenCount', '?')}"
            )

        try:
            candidate = result["candidates"][0]
            # Log when generation stopped for any reason other than a clean finish
            finish_reason = candidate.get("finishReason")
            if finish_reason and finish_reason != "STOP":
                logger.warning(f"Gemini finishReason={finish_reason} (response likely incomplete)")

            parts = candidate["content"]["parts"]
            # Response may have multiple parts (e.g. thought + text).
            # The actual content is in the last part with a "text" key.
            for part in reversed(parts):
                if "text" in part:
                    return part["text"]
            raise KeyError("No text part found")
        except (KeyError, IndexError):
            logger.error(f"Unexpected Gemini response structure: {json.dumps(result)[:500]}")
            raise NetworkError("Unexpected response from Gemini API")

    async def recognize(self, image_data: bytes, language: str = "auto") -> List[TextRegion]:
        import asyncio

        if not self._api_key:
            raise ApiKeyError("Gemini API key not configured")

        img_width, img_height = _get_png_dimensions(image_data)
        if img_width == 0 or img_height == 0:
            logger.error("Could not read image dimensions from PNG header")
            return []

        prompt = self._build_prompt(language, self._target_language)

        response_text = await asyncio.to_thread(self._call_api, image_data, prompt)

        regions_data = _parse_json_response(response_text)
        if regions_data is None:
            return []

        raw_region_count = len(regions_data)
        text_regions = []
        for region in regions_data:
            if not _validate_region(region):
                continue

            box = region["box_2d"]  # [y_min, x_min, y_max, x_max]
            y_min, x_min, y_max, x_max = box

            # Clamp to valid range before converting to pixel coords
            x_min = max(0, min(1000, x_min))
            y_min = max(0, min(1000, y_min))
            x_max = max(0, min(1000, x_max))
            y_max = max(0, min(1000, y_max))

            rect = {
                "left": int(x_min * img_width / 1000),
                "top": int(y_min * img_height / 1000),
                "right": int(x_max * img_width / 1000),
                "bottom": int(y_max * img_height / 1000),
            }

            text = region.get("text", "").strip()
            translated = region.get("translated_text", "").strip()
            if not text:
                continue

            text_regions.append(TextRegion(
                text=text,
                rect=rect,
                confidence=0.9,
                translated_text=translated if translated else text,
            ))

        logger.info(
            f"Gemini Vision: {len(text_regions)}/{raw_region_count} valid regions"
        )
        for i, r in enumerate(text_regions):
            logger.debug(f"  [{i}] '{r.text}' -> '{r.translated_text}' at {r.rect}")

        return text_regions

    def list_available_models(self) -> List[str]:
        """Fetch available flash models from Gemini API."""
        if not self._api_key:
            return []

        try:
            url = f"{GEMINI_API_URL}?key={self._api_key}"
            resp = requests.get(url, timeout=10)
            if resp.status_code != 200:
                logger.warning(f"Failed to list Gemini models: {resp.status_code}")
                return []

            models = []
            for m in resp.json().get("models", []):
                name = m.get("name", "").replace("models/", "")
                methods = m.get("supportedGenerationMethods", [])
                # Only flash models that support generateContent and have vision input
                if "generateContent" in methods and "flash" in name and "tts" not in name and "image" not in name and "live" not in name:
                    models.append(name)

            logger.info(f"Available Gemini models: {models}")
            return sorted(models)
        except Exception as e:
            logger.warning(f"Failed to fetch Gemini models: {e}")
            return []

    async def verify_api_key(self) -> tuple:
        """Quick check that the API key works. Returns (success, error_message)."""
        import asyncio

        if not self._api_key:
            return False, "No API key configured"

        def _check():
            url = f"{GEMINI_API_URL}/{self._model}:generateContent?key={self._api_key}"
            payload = {
                "contents": [{"parts": [{"text": "Reply with just the word: ok"}]}],
                "generationConfig": {"maxOutputTokens": 10}
            }
            try:
                resp = requests.post(url, json=payload, timeout=10)
                if resp.status_code == 200:
                    return True, ""
                return False, classify_google_error(resp.status_code, resp.text)
            except Exception as e:
                return False, str(e)

        return await asyncio.to_thread(_check)

    async def test_network(self) -> tuple:
        import asyncio

        if not self._api_key:
            return False, "API key required"

        def _probe():
            url = f"{GEMINI_API_URL}?key={self._api_key}&pageSize=1"
            try:
                resp = requests.get(url, timeout=4)
            except (requests.ConnectionError, requests.Timeout):
                return False, "Network unreachable"
            except Exception as e:
                return False, f"Probe failed: {type(e).__name__}"
            if resp.status_code == 200:
                return True, ""
            return False, classify_google_error(resp.status_code, resp.text)

        return await asyncio.to_thread(_probe)
