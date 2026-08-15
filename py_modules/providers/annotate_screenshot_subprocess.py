"""Pillow worker for annotated LLM screenshots.

Decky executes the plugin backend with Python 3.11, while the packaged Pillow
wheel uses the bundled Python 3.13 ABI. This module is therefore both importable
for compatible development environments and executable by the bundled runtime.
"""

from __future__ import annotations

import base64
import io
import json
import sys
from typing import List


def annotate_screenshot(image_bytes: bytes, blocks: List[dict], max_image_edge: int) -> bytes:
    from PIL import Image, ImageDraw

    with Image.open(io.BytesIO(image_bytes)) as source:
        image = source.convert("RGB")
        draw = ImageDraw.Draw(image)
        line_width = max(2, round(max(image.size) / 500))

        for block in blocks:
            rect = block.get("rect") or {}
            try:
                left = int(rect["left"])
                top = int(rect["top"])
                right = int(rect["right"])
                bottom = int(rect["bottom"])
            except (KeyError, TypeError, ValueError):
                continue

            item_id = str(block["id"])
            draw.rectangle((left, top, right, bottom), outline=(255, 55, 55), width=line_width)
            label = f" {item_id} "
            label_box = draw.textbbox((0, 0), label)
            label_width = label_box[2] - label_box[0]
            label_height = label_box[3] - label_box[1] + 4
            label_top = max(0, top - label_height)
            draw.rectangle(
                (left, label_top, left + label_width, label_top + label_height),
                fill=(205, 20, 20),
            )
            draw.text((left, label_top + 1), label, fill=(255, 255, 255))

        if max(image.size) > max_image_edge:
            image.thumbnail((max_image_edge, max_image_edge), Image.Resampling.LANCZOS)

        output = io.BytesIO()
        image.save(output, format="JPEG", quality=75, optimize=True)
        return output.getvalue()


def main() -> int:
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    result = annotate_screenshot(
        base64.b64decode(payload["image"], validate=True),
        payload["blocks"],
        int(payload["maxImageEdge"]),
    )
    sys.stdout.buffer.write(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
