export const MAX_ASK_AI_QUESTION_CHARS = 4000;

export interface AskAIScreenRegion {
    id: string;
    originalText: string;
    translatedText: string;
    rect: {
        left: number;
        top: number;
        right: number;
        bottom: number;
    };
}

export interface AskAITextPart {
    id: string;
    type: 'text';
    text: string;
}

export interface AskAIReferencePart {
    id: string;
    type: 'reference';
    regionId: string;
    originalText: string;
    translatedText: string;
}

export type AskAIComposerPart = AskAITextPart | AskAIReferencePart;

export type AskAIRequestPart =
    | { type: 'text'; text: string }
    | { type: 'reference'; regionId: string };

export interface AskAIInsertionAnchor {
    partId: string;
    offset: number;
}

export class AskAIComposerState {
    private parts: AskAIComposerPart[];
    private insertionAnchor: AskAIInsertionAnchor;
    private nextPartNumber = 1;

    constructor(initialText = '') {
        const first = this.createTextPart(initialText);
        this.parts = [first];
        this.insertionAnchor = { partId: first.id, offset: first.text.length };
    }

    getParts(): readonly AskAIComposerPart[] {
        return this.parts;
    }

    getInsertionAnchor(): AskAIInsertionAnchor {
        return { ...this.insertionAnchor };
    }

    reset(): void {
        const first = this.createTextPart();
        this.parts = [first];
        this.insertionAnchor = { partId: first.id, offset: 0 };
    }

    setInsertionAnchor(partId: string, offset: number): void {
        const part = this.parts.find((candidate): candidate is AskAITextPart => (
            candidate.id === partId && candidate.type === 'text'
        ));
        if (!part) return;
        this.insertionAnchor = {
            partId,
            offset: Math.max(0, Math.min(part.text.length, Math.trunc(offset || 0))),
        };
    }

    updateTextPart(partId: string, text: string, caretOffset?: number): void {
        const part = this.parts.find((candidate): candidate is AskAITextPart => (
            candidate.id === partId && candidate.type === 'text'
        ));
        if (!part) return;

        const otherTextLength = this.parts.reduce((total, candidate) => (
            candidate.type === 'text' && candidate.id !== partId
                ? total + candidate.text.length
                : total
        ), 0);
        const remaining = Math.max(0, MAX_ASK_AI_QUESTION_CHARS - otherTextLength);
        part.text = text.slice(0, remaining);
        this.setInsertionAnchor(partId, caretOffset ?? part.text.length);
    }

    insertReferences(regions: readonly AskAIScreenRegion[]): void {
        if (!regions.length) return;

        let index = this.parts.findIndex((part) => (
            part.id === this.insertionAnchor.partId && part.type === 'text'
        ));
        if (index < 0) {
            index = this.findLastTextPartIndex();
        }

        const target = this.parts[index] as AskAITextPart;
        const offset = Math.max(0, Math.min(target.text.length, this.insertionAnchor.offset));
        const before: AskAITextPart = { ...target, text: target.text.slice(0, offset) };
        const after = this.createTextPart(target.text.slice(offset));
        const references = regions.map((region): AskAIReferencePart => ({
            id: this.createPartId('reference'),
            type: 'reference',
            regionId: region.id,
            originalText: region.originalText,
            translatedText: region.translatedText,
        }));

        this.parts.splice(index, 1, before, ...references, after);
        this.insertionAnchor = { partId: after.id, offset: 0 };
    }

    removeReference(partId: string): void {
        const index = this.parts.findIndex((part) => part.id === partId && part.type === 'reference');
        if (index < 0) return;
        this.parts.splice(index, 1);

        const before = this.parts[index - 1];
        const after = this.parts[index];
        if (before?.type === 'text' && after?.type === 'text') {
            const joinOffset = before.text.length;
            before.text += after.text;
            this.parts.splice(index, 1);
            this.insertionAnchor = { partId: before.id, offset: joinOffset };
        } else {
            const fallbackIndex = this.findLastTextPartIndex();
            const fallback = this.parts[fallbackIndex] as AskAITextPart;
            this.insertionAnchor = { partId: fallback.id, offset: fallback.text.length };
        }
    }

    hasQuestionText(): boolean {
        return this.parts.some((part) => part.type === 'text' && part.text.trim().length > 0);
    }

    getReferenceCount(): number {
        return this.parts.filter((part) => part.type === 'reference').length;
    }

    toRequestParts(): AskAIRequestPart[] {
        return this.parts.flatMap((part): AskAIRequestPart[] => {
            if (part.type === 'reference') {
                return [{ type: 'reference', regionId: part.regionId }];
            }
            return part.text.length ? [{ type: 'text', text: part.text }] : [];
        });
    }

    private findLastTextPartIndex(): number {
        for (let index = this.parts.length - 1; index >= 0; index--) {
            if (this.parts[index].type === 'text') return index;
        }
        const textPart = this.createTextPart();
        this.parts.push(textPart);
        return this.parts.length - 1;
    }

    private createTextPart(text = ''): AskAITextPart {
        return { id: this.createPartId('text'), type: 'text', text };
    }

    private createPartId(kind: 'text' | 'reference'): string {
        return `${kind}-${this.nextPartNumber++}`;
    }
}
