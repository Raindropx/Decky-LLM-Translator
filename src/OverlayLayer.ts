export const ACTIVE_OVERLAY_Z_INDEX = 7002;
export const PASSIVE_PASSTHROUGH_Z_INDEX = -1;

export function getTranslationOverlayZIndex(
    passthroughMode: boolean,
    regionSelectionActive: boolean,
    passthroughAlwaysOnTop: boolean,
): number {
    return passthroughMode && !regionSelectionActive && !passthroughAlwaysOnTop
        ? PASSIVE_PASSTHROUGH_Z_INDEX
        : ACTIVE_OVERLAY_Z_INDEX;
}
