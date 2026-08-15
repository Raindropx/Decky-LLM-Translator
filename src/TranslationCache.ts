import type { TextRegion } from "./TextRecognizer";
import type { TranslatedRegion } from "./TextTranslator";

interface TranslationCacheEntry {
    sourceTexts: string[];
    translatedTexts: string[];
}

/**
 * A deliberately bounded cache for the most recent successful full-screen
 * translation. Coordinates are excluded from the cache key, but region count,
 * order, and every source-text character must match exactly.
 */
export class LastTranslationCache {
    private entry: TranslationCacheEntry | null = null;
    private revision = 0;

    getRevision(): number {
        return this.revision;
    }

    get(textRegions: readonly TextRegion[]): TranslatedRegion[] | null {
        if (!this.entry || this.entry.sourceTexts.length !== textRegions.length) {
            return null;
        }

        for (let index = 0; index < textRegions.length; index++) {
            if (textRegions[index].text !== this.entry.sourceTexts[index]) {
                return null;
            }
        }

        return textRegions.map((region, index) => ({
            ...region,
            translatedText: this.entry!.translatedTexts[index],
        }));
    }

    store(
        sourceRegions: readonly TextRegion[],
        translatedRegions: readonly TranslatedRegion[],
        expectedRevision: number = this.revision,
    ): boolean {
        if (
            expectedRevision !== this.revision
            || sourceRegions.length === 0
            || sourceRegions.length !== translatedRegions.length
            || translatedRegions.some((region, index) => (
                region.text !== sourceRegions[index].text
                || typeof region.translatedText !== 'string'
            ))
        ) {
            return false;
        }

        this.entry = {
            sourceTexts: sourceRegions.map((region) => region.text),
            translatedTexts: translatedRegions.map((region) => region.translatedText),
        };
        return true;
    }

    clear(): void {
        this.entry = null;
        this.revision++;
    }
}
