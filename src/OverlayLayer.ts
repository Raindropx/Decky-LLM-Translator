export const ACTIVE_OVERLAY_Z_INDEX = 7002;
export const PASSIVE_PASSTHROUGH_Z_INDEX = -1;

export interface OverlayControlPosition {
    left: number;
    top: number;
}

interface ClampOverlayControlPositionOptions extends OverlayControlPosition {
    viewportWidth: number;
    viewportHeight: number;
    controlWidth: number;
    controlHeight: number;
}

export function clampOverlayControlPosition({
    left,
    top,
    viewportWidth,
    viewportHeight,
    controlWidth,
    controlHeight,
}: ClampOverlayControlPositionOptions): OverlayControlPosition {
    return {
        left: Math.min(Math.max(0, viewportWidth - controlWidth), Math.max(0, left)),
        top: Math.min(Math.max(0, viewportHeight - controlHeight), Math.max(0, top)),
    };
}

export function getTranslationOverlayZIndex(
    passthroughMode: boolean,
    regionSelectionActive: boolean,
    passthroughAlwaysOnTop: boolean,
): number {
    return passthroughMode && !regionSelectionActive && !passthroughAlwaysOnTop
        ? PASSIVE_PASSTHROUGH_Z_INDEX
        : ACTIVE_OVERLAY_Z_INDEX;
}
