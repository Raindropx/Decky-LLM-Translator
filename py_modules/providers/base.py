"""Shared OCR provider types and errors."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional


class NetworkError(Exception):
    """Raised when a network connection error occurs."""


class ApiKeyError(Exception):
    """Raised when an API key is invalid or missing."""


class RateLimitError(Exception):
    """Raised when an API rate limit is exceeded."""


def classify_google_error(status_code: int, body: str) -> str:
    """Return a user-facing description for a Google API error."""
    body = body or ""
    if "API_KEY_INVALID" in body or "API key not valid" in body:
        return "Invalid API key"
    if "SERVICE_DISABLED" in body or "has not been used" in body or "it is disabled" in body:
        return "API not enabled in Cloud project"
    if "BILLING_DISABLED" in body or "billing" in body:
        return "Billing not enabled"
    if status_code == 401:
        return "Invalid API key"
    if status_code == 403:
        return "Access blocked (key restriction)"
    if status_code == 429:
        return "Rate limited"
    return f"API error ({status_code})"


class ProviderType(Enum):
    """Available OCR provider types."""

    GOOGLE = "google"
    OCR_SPACE = "ocrspace"
    RAPIDOCR = "rapidocr"
    LEGACY_GEMINI_VISION = "legacy_gemini_vision"
    CHROME_SCREEN_AI = "chromescreenai"


@dataclass
class TextRegion:
    """A detected OCR region and its local overlay coordinates."""

    text: str
    rect: Dict[str, int]
    confidence: float = 0.0
    is_dialog: bool = False
    bg_color: Optional[List[int]] = None
    translated_text: Optional[str] = None

    def to_dict(self) -> Dict:
        result = {
            "text": self.text,
            "rect": self.rect,
            "confidence": self.confidence,
            "isDialog": self.is_dialog,
        }
        if self.bg_color is not None:
            result["bgColor"] = self.bg_color
        if self.translated_text is not None:
            result["translatedText"] = self.translated_text
        return result


class OCRProvider(ABC):
    """Abstract base class for OCR providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the provider name."""

    @property
    @abstractmethod
    def provider_type(self) -> ProviderType:
        """Return the provider type enum."""

    @abstractmethod
    async def recognize(self, image_data: bytes, language: str = "auto") -> List[TextRegion]:
        """Recognize text and local coordinates in an image."""

    @abstractmethod
    def is_available(self, language: str = "auto") -> bool:
        """Return whether this provider can handle the requested language."""

    @abstractmethod
    def get_supported_languages(self) -> List[str]:
        """Return supported language codes."""
