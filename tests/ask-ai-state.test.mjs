import assert from 'node:assert/strict';
import test from 'node:test';

import { AskAIComposerState, MAX_ASK_AI_QUESTION_CHARS } from '../src/AskAIState.ts';

const region = (id, originalText, translatedText) => ({ id, originalText, translatedText });

test('inserts selected references at the remembered caret in click order', () => {
    const composer = new AskAIComposerState('Why is this different?');
    const firstText = composer.getParts()[0];
    composer.setInsertionAnchor(firstText.id, 7);
    composer.insertReferences([
        region('region-2', '原文二', 'Translation two'),
        region('region-1', '原文一', 'Translation one'),
    ]);

    assert.deepEqual(
        composer.getParts().map((part) => part.type === 'text' ? part.text : part.regionId),
        ['Why is ', 'region-2', 'region-1', 'this different?'],
    );
    assert.deepEqual(composer.toRequestParts(), [
        { type: 'text', text: 'Why is ' },
        { type: 'reference', regionId: 'region-2' },
        { type: 'reference', regionId: 'region-1' },
        { type: 'text', text: 'this different?' },
    ]);
});

test('supports repeated selection rounds at different question positions', () => {
    const composer = new AskAIComposerState('Compare  with .');
    const firstText = composer.getParts()[0];
    composer.setInsertionAnchor(firstText.id, 8);
    composer.insertReferences([region('region-1', '甲', 'A')]);

    const trailingText = composer.getParts().find((part) => part.type === 'text' && part.text === ' with .');
    composer.setInsertionAnchor(trailingText.id, 6);
    composer.insertReferences([region('region-2', '乙', 'B')]);

    assert.deepEqual(
        composer.toRequestParts().filter((part) => part.type === 'reference').map((part) => part.regionId),
        ['region-1', 'region-2'],
    );
});

test('removing a reference merges the neighboring editable text parts', () => {
    const composer = new AskAIComposerState('Before after');
    const initial = composer.getParts()[0];
    composer.setInsertionAnchor(initial.id, 7);
    composer.insertReferences([region('region-1', '原文', 'Translation')]);
    const reference = composer.getParts().find((part) => part.type === 'reference');

    composer.removeReference(reference.id);

    assert.deepEqual(composer.getParts().map((part) => part.type), ['text']);
    assert.equal(composer.getParts()[0].text, 'Before after');
});

test('keeps full reference text while limiting only user-authored question text', () => {
    const composer = new AskAIComposerState();
    const text = composer.getParts()[0];
    composer.updateTextPart(text.id, 'x'.repeat(MAX_ASK_AI_QUESTION_CHARS + 50));
    composer.insertReferences([region('region-1', '原'.repeat(500), '译'.repeat(500))]);

    const reference = composer.getParts().find((part) => part.type === 'reference');
    assert.equal(composer.getParts()[0].text.length, MAX_ASK_AI_QUESTION_CHARS);
    assert.equal(reference.originalText.length, 500);
    assert.equal(reference.translatedText.length, 500);
});

test('resets the question, references, and insertion anchor for a new question', () => {
    const composer = new AskAIComposerState('Explain ');
    const initial = composer.getParts()[0];
    composer.setInsertionAnchor(initial.id, initial.text.length);
    composer.insertReferences([region('region-1', '原文', 'Translation')]);

    composer.reset();

    assert.deepEqual(composer.getParts().map((part) => ({ type: part.type, text: part.text })), [
        { type: 'text', text: '' },
    ]);
    assert.deepEqual(composer.toRequestParts(), []);
    assert.equal(composer.getReferenceCount(), 0);
    assert.equal(composer.hasQuestionText(), false);
    assert.deepEqual(composer.getInsertionAnchor(), {
        partId: composer.getParts()[0].id,
        offset: 0,
    });
});
