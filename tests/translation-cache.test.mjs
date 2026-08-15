import assert from 'node:assert/strict';
import test from 'node:test';

import { LastTranslationCache } from '../src/TranslationCache.ts';

function region(text, left = 0, top = 0) {
    return {
        text,
        rect: { left, top, right: left + 100, bottom: top + 30 },
        isDialog: false,
    };
}

function translated(text, translatedText, left = 0, top = 0) {
    return { ...region(text, left, top), translatedText };
}

test('hits when every box text matches exactly despite coordinate changes', () => {
    const cache = new LastTranslationCache();
    cache.store(
        [region('Start', 10, 20), region('Options', 10, 60)],
        [translated('Start', '开始', 10, 20), translated('Options', '选项', 10, 60)],
    );

    const current = [region('Start', 14, 22), region('Options', 8, 63)];
    const hit = cache.get(current);

    assert.deepEqual(hit?.map((item) => item.translatedText), ['开始', '选项']);
    assert.deepEqual(hit?.map((item) => item.rect), current.map((item) => item.rect));
});

test('misses when one character differs', () => {
    const cache = new LastTranslationCache();
    cache.store([region('Start')], [translated('Start', '开始')]);

    assert.equal(cache.get([region('Stark')]), null);
});

test('misses when the box count changes even if concatenated text is equal', () => {
    const cache = new LastTranslationCache();
    cache.store(
        [region('New'), region('Game')],
        [translated('New', '新'), translated('Game', '游戏')],
    );

    assert.equal(cache.get([region('NewGame')]), null);
});

test('misses when the same total text is partitioned differently', () => {
    const cache = new LastTranslationCache();
    cache.store(
        [region('New'), region('Game')],
        [translated('New', '新'), translated('Game', '游戏')],
    );

    assert.equal(cache.get([region('Ne'), region('wGame')]), null);
});

test('misses when box order changes', () => {
    const cache = new LastTranslationCache();
    cache.store(
        [region('Start'), region('Options')],
        [translated('Start', '开始'), translated('Options', '选项')],
    );

    assert.equal(cache.get([region('Options'), region('Start')]), null);
});

test('retains only the most recent successful screen', () => {
    const cache = new LastTranslationCache();
    cache.store([region('First')], [translated('First', '第一')]);
    cache.store([region('Second')], [translated('Second', '第二')]);

    assert.equal(cache.get([region('First')]), null);
    assert.deepEqual(cache.get([region('Second')])?.map((item) => item.translatedText), ['第二']);
});

test('does not replace the last entry with an invalid result', () => {
    const cache = new LastTranslationCache();
    cache.store([region('Stable')], [translated('Stable', '稳定')]);

    assert.equal(cache.store([region('Broken')], []), false);
    assert.deepEqual(cache.get([region('Stable')])?.map((item) => item.translatedText), ['稳定']);
});

test('rejects a translated result whose source boxes are reordered', () => {
    const cache = new LastTranslationCache();

    assert.equal(
        cache.store(
            [region('First'), region('Second')],
            [translated('Second', '第二'), translated('First', '第一')],
        ),
        false,
    );
    assert.equal(cache.get([region('First'), region('Second')]), null);
});

test('rejects an in-flight result after the cache is invalidated', () => {
    const cache = new LastTranslationCache();
    const requestRevision = cache.getRevision();
    cache.clear();

    assert.equal(
        cache.store(
            [region('Old language')],
            [translated('Old language', '旧语言')],
            requestRevision,
        ),
        false,
    );
    assert.equal(cache.get([region('Old language')]), null);
});
