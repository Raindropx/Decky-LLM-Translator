import type { ScreenshotOverlaySnapshot } from "./Overlay";
import type { TranslatedRegion } from "./TextTranslator";
import {
    buildTranslatedFontFamily,
    ensureFontLoaded,
    resolveFontStyleCSS,
} from "./fonts";

export interface SteamScreenshotResponse {
    found: boolean;
    reason?: string;
    capture_token?: string;
    mime?: string;
    base64?: string;
}

interface ScaledRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not decode screenshot image"));
        image.src = src;
    });
}

function redistributeText(flat: string, maxLines: number): string {
    if (maxLines <= 1 || flat.length === 0) return flat;
    if (!flat.includes(" ")) {
        const charsPerLine = Math.ceil(flat.length / maxLines);
        const lines: string[] = [];
        for (let index = 0; index < flat.length; index += charsPerLine) {
            lines.push(flat.slice(index, index + charsPerLine));
        }
        return lines.join("\n");
    }

    const words = flat.split(/\s+/);
    if (words.length <= maxLines) return words.join("\n");
    const longestWord = Math.max(...words.map(word => word.length));
    let low = longestWord;
    let high = flat.length;
    const canFit = (maxWidth: number): boolean => {
        let lineCount = 1;
        let lineLength = 0;
        for (const word of words) {
            if (lineLength === 0) {
                lineLength = word.length;
            } else if (lineLength + 1 + word.length <= maxWidth) {
                lineLength += 1 + word.length;
            } else {
                lineCount += 1;
                lineLength = word.length;
                if (lineCount > maxLines) return false;
            }
        }
        return true;
    };
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (canFit(middle)) high = middle;
        else low = middle + 1;
    }

    const lines: string[] = [];
    let current = "";
    for (const word of words) {
        if (!current || current.length + 1 + word.length <= low) {
            current = current ? `${current} ${word}` : word;
        } else {
            lines.push(current);
            current = word;
        }
    }
    if (current) lines.push(current);
    return lines.join("\n");
}

function calculateFontSize(
    region: TranslatedRegion,
    scalingFactor: number,
    fontScale: number,
): number {
    const regionWidth = (region.rect.right - region.rect.left) * scalingFactor;
    const regionHeight = (region.rect.bottom - region.rect.top) * scalingFactor;
    const text = region.translatedText || region.text;
    if (!text.length) return 12;

    let fontSize = Math.sqrt((regionWidth * regionHeight) / text.length * 0.7);
    const availableWidth = regionWidth - 4;
    const availableHeight = regionHeight - 2;
    if (availableWidth <= 0 || availableHeight <= 0) return 7;

    const charsPerLine = Math.max(1, Math.floor(availableWidth / (fontSize * 0.6)));
    const lines = text.split("\n").reduce(
        (total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)),
        0,
    );
    const neededHeight = lines * fontSize * 1.15;
    if (neededHeight > availableHeight) fontSize *= availableHeight / neededHeight;
    fontSize *= fontScale;
    return Math.max(7, Math.min(fontSize, 48));
}

function wrapText(
    context: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
): string[] {
    const result: string[] = [];
    const addTokenizedLine = (rawLine: string) => {
        if (!rawLine) {
            result.push("");
            return;
        }
        const tokens = rawLine.includes(" ")
            ? rawLine.split(/(\s+)/).filter(Boolean)
            : Array.from(rawLine);
        let current = "";
        for (const token of tokens) {
            const candidate = current + token;
            if (current && context.measureText(candidate).width > maxWidth) {
                result.push(current.trimEnd());
                current = token.trimStart();
            } else {
                current = candidate;
            }
        }
        if (current || result.length === 0) result.push(current.trimEnd());
    };
    for (const line of text.split("\n")) addTokenizedLine(line);
    return result;
}

function roundedRect(
    context: CanvasRenderingContext2D,
    left: number,
    top: number,
    width: number,
    height: number,
    radius: number,
) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(left + r, top);
    context.lineTo(left + width - r, top);
    context.quadraticCurveTo(left + width, top, left + width, top + r);
    context.lineTo(left + width, top + height - r);
    context.quadraticCurveTo(left + width, top + height, left + width - r, top + height);
    context.lineTo(left + r, top + height);
    context.quadraticCurveTo(left, top + height, left, top + height - r);
    context.lineTo(left, top + r);
    context.quadraticCurveTo(left, top, left + r, top);
    context.closePath();
}

function drawJustifiedLine(
    context: CanvasRenderingContext2D,
    line: string,
    left: number,
    baseline: number,
    width: number,
    justify: boolean,
) {
    const words = line.trim().split(/\s+/);
    if (!justify || words.length < 2) {
        context.fillText(line, left, baseline);
        return;
    }
    const wordsWidth = words.reduce(
        (total, word) => total + context.measureText(word).width,
        0,
    );
    const gap = Math.max(0, (width - wordsWidth) / (words.length - 1));
    let x = left;
    for (const word of words) {
        context.fillText(word, x, baseline);
        x += context.measureText(word).width + gap;
    }
}

async function waitForSelectedFont(fontFamily: string): Promise<void> {
    ensureFontLoaded(fontFamily);
    if (!document.fonts?.load) return;
    const family = buildTranslatedFontFamily(fontFamily);
    await Promise.race([
        document.fonts.load(`16px ${family}`).then(() => undefined),
        new Promise<void>(resolve => setTimeout(resolve, 1500)),
    ]);
}

export async function renderTranslatedSteamScreenshot(
    nativeBase64: string,
    nativeMime: string,
    snapshot: ScreenshotOverlaySnapshot,
): Promise<string> {
    if (!nativeBase64 || !snapshot.imageData || !snapshot.regions.length) {
        throw new Error("Translation overlay is not ready for screenshot rendering");
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(nativeMime)) {
        throw new Error(`Unsupported Steam screenshot type: ${nativeMime}`);
    }

    await waitForSelectedFont(snapshot.translatedTextFontFamily);
    const referenceSrc = snapshot.imageData.startsWith("data:")
        ? snapshot.imageData
        : `data:image/png;base64,${snapshot.imageData}`;
    const [nativeImage, referenceImage] = await Promise.all([
        loadImage(`data:${nativeMime};base64,${nativeBase64}`),
        loadImage(referenceSrc),
    ]);

    const canvas = document.createElement("canvas");
    canvas.width = nativeImage.naturalWidth;
    canvas.height = nativeImage.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering is unavailable");
    context.drawImage(nativeImage, 0, 0);

    const widthFactor = canvas.width / referenceImage.naturalWidth;
    const heightFactor = canvas.height / referenceImage.naturalHeight;
    const generalFactor = (widthFactor + heightFactor) / 2;
    const pad = Math.max(1, Math.round(4 * generalFactor));
    const gap = Math.max(1, Math.round(2 * generalFactor));
    const scaled: ScaledRect[] = snapshot.regions.map(region => ({
        left: Math.round(region.rect.left * widthFactor - pad),
        top: Math.round(region.rect.top * heightFactor - pad),
        width: Math.round((region.rect.right - region.rect.left) * widthFactor + pad * 2),
        height: Math.round((region.rect.bottom - region.rect.top) * heightFactor + pad * 2),
    }));

    const expansionLimits = scaled.map((rect, index) => {
        let maxRight = canvas.width;
        let minLeft = 0;
        const bottom = rect.top + rect.height;
        scaled.forEach((other, otherIndex) => {
            if (index === otherIndex) return;
            if (rect.top < other.top + other.height && bottom > other.top) {
                if (other.left > rect.left) maxRight = Math.min(maxRight, other.left - gap);
                if (other.left < rect.left) minLeft = Math.max(minLeft, other.left + other.width + gap);
            }
        });
        return {
            right: Math.max(0, maxRight - (rect.left + rect.width)),
            left: Math.max(0, rect.left - minLeft),
        };
    });

    const fontFamily = buildTranslatedFontFamily(snapshot.translatedTextFontFamily);
    const fontStyle = resolveFontStyleCSS(snapshot.translatedTextFontStyle);
    snapshot.regions.forEach((region, index) => {
        const rect = scaled[index];
        const fontSize = Math.round(calculateFontSize(region, generalFactor, snapshot.fontScale));
        const lineHeight = fontSize * 1.15;
        let displayText = region.translatedText || region.text;
        if (snapshot.allowLabelGrowth) {
            const maxLines = Math.max(1, Math.floor((rect.height - 4) / lineHeight));
            displayText = redistributeText(displayText.replace(/\n/g, " ").trim(), maxLines);
        }

        const stylePrefix = `${fontStyle.fontStyle} ${fontStyle.fontWeight}`;
        context.font = `${stylePrefix} ${fontSize}px ${fontFamily}`;
        context.textBaseline = "middle";

        let maxWidth = rect.width;
        let left = rect.left;
        if (snapshot.allowLabelGrowth) {
            const limits = expansionLimits[index];
            if (snapshot.translatedTextAlignment === "left") {
                maxWidth += limits.right;
            } else if (snapshot.translatedTextAlignment === "right") {
                maxWidth += limits.left;
            } else {
                maxWidth += Math.min(limits.left, limits.right) * 2;
            }
        }

        const maxTextWidth = Math.max(1, maxWidth - 4);
        let lines = wrapText(context, displayText, maxTextWidth);
        const measuredWidth = Math.max(
            rect.width,
            ...lines.map(line => context.measureText(line).width + 4),
        );
        const width = snapshot.allowLabelGrowth
            ? Math.min(maxWidth, measuredWidth)
            : rect.width;
        lines = wrapText(context, displayText, Math.max(1, width - 4));

        if (snapshot.allowLabelGrowth) {
            if (snapshot.translatedTextAlignment === "right") {
                left = rect.left + rect.width - width;
            } else if (["center", "justify"].includes(snapshot.translatedTextAlignment)) {
                left = rect.left + rect.width / 2 - width / 2;
            }
        }
        left = Math.max(0, Math.min(canvas.width - width, left));
        const height = Math.max(rect.height, lines.length * lineHeight + 2);
        const top = Math.max(0, Math.min(canvas.height - height, rect.top));

        context.fillStyle = snapshot.passthroughMode
            ? `rgba(0, 0, 0, ${snapshot.textBoxOpacity / 100})`
            : "rgba(0, 0, 0, 0.8)";
        roundedRect(context, left, top, width, height, Math.round(6 * generalFactor));
        context.fill();

        context.fillStyle = "#FFFFFF";
        const textWidth = Math.max(1, width - 4);
        const firstBaseline = top + (height - lines.length * lineHeight) / 2 + lineHeight / 2;
        lines.forEach((line, lineIndex) => {
            const measured = context.measureText(line).width;
            let textLeft = left + 2;
            if (snapshot.translatedTextAlignment === "right") {
                textLeft = left + width - 2 - measured;
            } else if (snapshot.translatedTextAlignment === "center") {
                textLeft = left + (width - measured) / 2;
            }
            const baseline = firstBaseline + lineIndex * lineHeight;
            drawJustifiedLine(
                context,
                line,
                textLeft,
                baseline,
                textWidth,
                snapshot.translatedTextAlignment === "justify" && lineIndex < lines.length - 1,
            );
        });
    });

    return canvas.toDataURL(nativeMime, nativeMime === "image/png" ? undefined : 0.92);
}
