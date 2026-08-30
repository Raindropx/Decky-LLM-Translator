import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ACTIVE_OVERLAY_Z_INDEX,
    PASSIVE_PASSTHROUGH_Z_INDEX,
    clampOverlayControlPosition,
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

test('dragged selection controls stay inside the viewport', () => {
    assert.deepEqual(clampOverlayControlPosition({
        left: 700,
        top: 520,
        viewportWidth: 854,
        viewportHeight: 534,
        controlWidth: 350,
        controlHeight: 60,
    }), { left: 504, top: 474 });

    assert.deepEqual(clampOverlayControlPosition({
        left: -30,
        top: -20,
        viewportWidth: 854,
        viewportHeight: 534,
        controlWidth: 350,
        controlHeight: 60,
    }), { left: 0, top: 0 });
});
