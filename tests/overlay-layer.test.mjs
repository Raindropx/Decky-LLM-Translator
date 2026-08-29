import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ACTIVE_OVERLAY_Z_INDEX,
    PASSIVE_PASSTHROUGH_Z_INDEX,
    getTranslationOverlayZIndex,
} from '../src/OverlayLayer.ts';

test('passive passthrough stays below Steam UI', () => {
    assert.equal(
        getTranslationOverlayZIndex(true, false, false),
        PASSIVE_PASSTHROUGH_Z_INDEX,
    );
    assert.ok(PASSIVE_PASSTHROUGH_Z_INDEX < 0);
});

test('region selection returns passthrough to the interactive overlay layer', () => {
    assert.equal(
        getTranslationOverlayZIndex(true, true, false),
        ACTIVE_OVERLAY_Z_INDEX,
    );
});

test('always-on-top passthrough can translate Steam UI', () => {
    assert.equal(
        getTranslationOverlayZIndex(true, false, true),
        ACTIVE_OVERLAY_Z_INDEX,
    );
});

test('normal screenshot overlay keeps its existing active layer', () => {
    assert.equal(
        getTranslationOverlayZIndex(false, false, false),
        ACTIVE_OVERLAY_Z_INDEX,
    );
});
