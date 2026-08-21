// src/tabs/TabControls.tsx - Input controls, behavior settings, and debug

import {
    PanelSection,
    PanelSectionRow,
    DropdownItem,
    ToggleField,
    SliderField,
    Field
} from "@decky/ui";

import { VFC, useState } from "react";
import { useSettings } from "../SettingsContext";
import { InputMode } from "../Input";
import { useFontOptions, isRemoteFont, loadRemoteFont } from "../fonts";
import { t } from "../i18n";

// Input mode options for dropdown
const inputModeOptions = [
    { label: "L3 (Left Stick Click)", data: InputMode.L3_BUTTON },
    { label: "L4", data: InputMode.L4_BUTTON },
    { label: "L5", data: InputMode.L5_BUTTON },
    { label: "R3 (Right Stick Click)", data: InputMode.R3_BUTTON },
    { label: "R4", data: InputMode.R4_BUTTON },
    { label: "R5", data: InputMode.R5_BUTTON },
    { label: "L3 + R3 (Both Sticks Click)", data: InputMode.L3_R3_COMBO },
    { label: "L4 + R4", data: InputMode.L4_R4_COMBO },
    { label: "L5 + R5", data: InputMode.L5_R5_COMBO },
    { label: "Both Touchpads Touch", data: InputMode.TOUCHPAD_COMBO }
];

const translatedTextAlignmentOptions = [
    { label: "Left", data: 'left' },
    { label: "Right", data: 'right' },
    { label: "Center", data: 'center' },
    { label: "Stretch", data: 'justify' }
];

const fontStyleLabels: Record<string, string> = {
    normal: 'Normal',
    bold: 'Bold',
    italic: 'Italic',
    bolditalic: 'Bold Italic'
};

// Helper to get button labels for current input mode
const getInputModeButtons = (mode: string): string => {
    switch (mode) {
        case 'L3_BUTTON': return 'L3';
        case 'L4_BUTTON': return 'L4';
        case 'L5_BUTTON': return 'L5';
        case 'R3_BUTTON': return 'R3';
        case 'R4_BUTTON': return 'R4';
        case 'R5_BUTTON': return 'R5';
        case 'L3_R3_COMBO': return 'L3 + R3';
        case 'L4_R4_COMBO': return 'L4 + R4';
        case 'L5_R5_COMBO': return 'L5 + R5';
        case 'TOUCHPAD_COMBO': return 'Left Pad + Right Pad';
        default: return mode;
    }
};

interface TabControlsProps {
    inputDiagnostics: any;
}

export const TabControls: VFC<TabControlsProps> = ({ inputDiagnostics }) => {
    const { settings, updateSetting } = useSettings();
    const { fontOptions, fontDescription, preloadWebFonts, unavailableDyslexiaFonts } = useFontOptions(
        settings.translatedTextFontFamily,
        settings.targetLanguage,
        () => updateSetting('translatedTextFontFamily', '', 'Text font'),
    );
    const [fontDropdownKey, setFontDropdownKey] = useState(0);

    return (
        <div>
            <PanelSection title={t("Interface")}>
                <PanelSectionRow>
                    <DropdownItem
                        layout="below"
                        label={t("Plugin Language")}
                        description={t("Choose the language used by the plugin interface")}
                        rgOptions={[
                            { label: t("System language"), data: "system" },
                            { label: t("Chinese"), data: "zh-CN" },
                            { label: t("English"), data: "en" },
                        ]}
                        selectedOption={settings.pluginLanguage}
                        onChange={(option) => updateSetting('pluginLanguage', option.data, t('Plugin Language'))}
                    />
                </PanelSectionRow>
            </PanelSection>

            <PanelSection title={t("Control")}>
                <PanelSectionRow>
                    <DropdownItem
                        layout="below"
                        label={t("Quick Translation Shortcut")}
                        description={t("Select which buttons to hold to start translaton")}
                        rgOptions={inputModeOptions.map((option) => ({ ...option, label: t(option.label) }))}
                        selectedOption={settings.inputMode}
                        onChange={(option) => updateSetting('inputMode', option.data, 'Input method')}
                    />
                </PanelSectionRow>

                <PanelSectionRow>
                    <SliderField
                        value={settings.holdTimeTranslate / 1000}
                        max={3}
                        min={0}
                        step={0.1}
                        label={t("Hold Time to Start")}
                        description={t("Seconds to hold button(s) to translate")}
                        showValue={true}
                        valueSuffix="s"
                        onChange={(value) => {
                            const milliseconds = Math.round(value * 1000);
                            updateSetting('holdTimeTranslate', milliseconds, 'Hold time');
                        }}
                    />
                </PanelSectionRow>

                <PanelSectionRow>
                    <SliderField
                        value={settings.holdTimeDismiss / 1000}
                        max={3}
                        min={0}
                        step={0.1}
                        label={t("Hold Time to Dismiss")}
                        description={t("Seconds to hold button(s) to dismiss overlay")}
                        showValue={true}
                        valueSuffix="s"
                        onChange={(value) => {
                            const milliseconds = Math.round(value * 1000);
                            updateSetting('holdTimeDismiss', milliseconds, 'Hold time for dismissal');
                        }}
                    />
                </PanelSectionRow>

                {/* Quick toggle option - only show for combo modes */}
                {(settings.inputMode === InputMode.L4_R4_COMBO ||
                    settings.inputMode === InputMode.L5_R5_COMBO ||
                    settings.inputMode === InputMode.L3_R3_COMBO ||
                    settings.inputMode === InputMode.TOUCHPAD_COMBO) && (
                    <PanelSectionRow>
                        <ToggleField
                            checked={settings.quickToggleEnabled}
                            label={t("Quick toggle with Right Button")}
                            description={t("If double buttons combination is selected, press right button to toggle overlay visibility")}
                            onChange={(value) => {
                                updateSetting('quickToggleEnabled', value, 'Quick toggle');
                            }}
                        />
                    </PanelSectionRow>
                )}
            </PanelSection>

            <PanelSection title={t("Display")}>
                <PanelSectionRow>
                    <ToggleField
                        checked={settings.passthroughMode}
                        label={t("Passthrough Mode")}
                        description={t("Keep the game live and show only translated text boxes instead of the captured screenshot")}
                        onChange={(value) => {
                            updateSetting('passthroughMode', value, 'Passthrough mode');
                        }}
                    />
                </PanelSectionRow>

                {settings.passthroughMode && (
                    <PanelSectionRow>
                        <SliderField
                            value={settings.textBoxOpacity}
                            min={0}
                            max={100}
                            step={5}
                            label={t("Text Box Opacity")}
                            description={t("Adjust the translated text box background without fading the text")}
                            showValue={true}
                            valueSuffix="%"
                            onChange={(value) => {
                                updateSetting('textBoxOpacity', Math.round(value), 'Text box opacity');
                            }}
                        />
                    </PanelSectionRow>
                )}

                <PanelSectionRow>
                    <SliderField
                        value={settings.fontScale}
                        max={3}
                        min={1}
                        step={0.1}
                        label={t("Font Scaling")}
                        description={t("Increase if translated text is too small. Can be useful for large external monitors")}
                        showValue={true}
                        valueSuffix="x"
                        onChange={(value) => {
                            const rounded = Math.round(value * 10) / 10;
                            updateSetting('fontScale', rounded, 'Font scale');
                        }}
                    />
                </PanelSectionRow>

                <PanelSectionRow>
                    <SliderField
                        value={settings.groupingPower}
                        min={0.25}
                        max={1.0}
                        step={0.25}
                        notchCount={4}
                        notchTicksVisible={true}
                        label={t("Text Blocks Grouping")}
                        description={
                            settings.groupingPower <= 0.25 ? t("Normal - Keeps text blocks separated") :
                            settings.groupingPower <= 0.5 ? t("Increased - Merges text blocks") :
                            settings.groupingPower <= 0.75 ? t("Large - Merges distant text blocks") :
                            t("Huge - Merges very distant text blocks")
                        }
                        onChange={(value) => {
                            updateSetting('groupingPower', value, 'Text grouping');
                        }}
                    />
                </PanelSectionRow>

                <PanelSectionRow>
                    <DropdownItem
                        layout="below"
                        label={t("Translated Text Alignment")}
                        description={t("Choose alignment for translated text labels")}
                        rgOptions={translatedTextAlignmentOptions.map((option) => ({ ...option, label: t(option.label) }))}
                        selectedOption={settings.translatedTextAlignment}
                        onChange={(option) => updateSetting('translatedTextAlignment', option.data, 'Text alignment')}
                    />
                </PanelSectionRow>

                <PanelSectionRow>
                    <DropdownItem
                        key={fontDropdownKey}
                        layout="below"
                        label={t("Translated Text Font")}
                        description={fontDescription}
                        rgOptions={fontOptions}
                        selectedOption={settings.translatedTextFontFamily}
                        onMenuWillOpen={(showMenu) => {
                            preloadWebFonts();
                            showMenu();
                        }}
                        onChange={(option) => {
                            const fontName = option.data;
                            if (fontName && unavailableDyslexiaFonts.has(fontName)) {
                                setFontDropdownKey(k => k + 1);
                                return;
                            }
                            if (fontName && isRemoteFont(fontName)) {
                                const previousFont = settings.translatedTextFontFamily;
                                updateSetting('translatedTextFontFamily', fontName, 'Text font');
                                loadRemoteFont(fontName).then((ok) => {
                                    if (!ok) {
                                        updateSetting('translatedTextFontFamily', previousFont, 'Text font');
                                    }
                                });
                            } else {
                                updateSetting('translatedTextFontFamily', fontName, 'Text font');
                            }
                        }}
                    />
                </PanelSectionRow>

                <PanelSectionRow>
                    <DropdownItem
                        layout="below"
                        label={t("Translated Text Style")}
                        description={t("Font weight and style for translated text")}
                        rgOptions={[
                            { label: <span>{t("Normal")}</span>, data: "normal" },
                            { label: <span style={{ fontWeight: 'bold' }}>{t("Bold")}</span>, data: "bold" },
                            { label: <span style={{ fontStyle: 'italic' }}>{t("Italic")}</span>, data: "italic" },
                            { label: <span style={{ fontWeight: 'bold', fontStyle: 'italic' }}>{t("Bold Italic")}</span>, data: "bolditalic" }
                        ]}
                        selectedOption={settings.translatedTextFontStyle}
                        renderButtonValue={() => t(fontStyleLabels[settings.translatedTextFontStyle] || 'Normal')}
                        onChange={(option) => updateSetting('translatedTextFontStyle', option.data, 'Text style')}
                    />
                </PanelSectionRow>

                <PanelSectionRow>
                    <ToggleField
                        checked={settings.hideIdenticalTranslations}
                        label={t("Hide Identical Translations")}
                        description={t("Don't display if translation is the same as original word/sentence")}
                        onChange={(value) => {
                            updateSetting('hideIdenticalTranslations', value, 'Hide identical translations');
                        }}
                    />
                </PanelSectionRow>

                <PanelSectionRow>
                    <ToggleField
                        checked={settings.allowLabelGrowth}
                        label={t("Allow Labels to Expand")}
                        description={t("Let translated labels grow wider if the text doesn't fit the original box")}
                        onChange={(value) => {
                            updateSetting('allowLabelGrowth', value, 'Allow label growth');
                        }}
                    />
                </PanelSectionRow>
            </PanelSection>

            <PanelSection title={t("Steam Screenshots")}>
                <PanelSectionRow>
                    <ToggleField
                        checked={settings.steamScreenshotTranslationEnabled}
                        label={t("Include Translations in Screenshots")}
                        description={t("Composite the currently visible translated text boxes into STEAM+R1 screenshots")}
                        onChange={(value) => {
                            updateSetting(
                                'steamScreenshotTranslationEnabled',
                                value,
                                'Screenshot translation',
                            );
                        }}
                    />
                </PanelSectionRow>

                {settings.steamScreenshotTranslationEnabled && (
                    <PanelSectionRow>
                        <ToggleField
                            checked={settings.steamScreenshotKeepOriginal}
                            label={t("Keep Original Screenshot")}
                            description={t("Keep Steam's native image and create a numbered translated copy beside it. Steam Media may not index plugin-created copies")}
                            onChange={(value) => {
                                updateSetting(
                                    'steamScreenshotKeepOriginal',
                                    value,
                                    'Keep original screenshot',
                                );
                            }}
                        />
                    </PanelSectionRow>
                )}
            </PanelSection>

            <PanelSection title={t("Behavior")}>
                <PanelSectionRow>
                    <ToggleField
                        checked={settings.pauseGameOnOverlay}
                        label={t("Pause Game While Translating")}
                        description={settings.passthroughMode
                            ? t("Ignored while Passthrough Mode is enabled so the game remains live")
                            : <>{t("Pauses the active game and allows you to read the text more thoughtfully. The game is resumed when overlay is dismissed.")}<br /><br />{t("Doesn't work well with game streaming (moonlight, geforce now, remote play, etc)")}</>}
                        onChange={(value) => {
                            updateSetting('pauseGameOnOverlay', value, 'Pause game while translating');
                        }}
                    />
                </PanelSectionRow>
            </PanelSection>

            <PanelSection title={t("Miscellaneous")}>
                <PanelSectionRow>
                    <ToggleField
                        label={t("Debug Mode")}
                        description={t("Enable verbose console logging and diagnostics panel")}
                        checked={settings.debugMode}
                        onChange={(value) => updateSetting('debugMode', value, 'Debug mode')}
                    />
                </PanelSectionRow>

                {/* Show diagnostics when debug mode is on */}
                {settings.debugMode && inputDiagnostics && (
                    <PanelSectionRow>
                        <Field
                            focusable={true}
                            childrenContainerWidth="max"
                        >
                            <div className="dt-debug-panel" style={{
                                backgroundColor: 'rgba(0,0,0,0.4)',
                                padding: '12px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontFamily: 'monospace',
                                border: '1px solid rgba(255,255,255,0.1)'
                            }}>
                                <div style={{ display: 'grid', gap: '3px' }}>
                                    <div>
                                        <span style={{ color: '#888' }}>{t("Status:")}</span>{' '}
                                        {inputDiagnostics.enabled ?
                                            (inputDiagnostics.healthy ? t('Healthy') : t('Unhealthy')) :
                                            t('Disabled')
                                        }
                                    </div>

                                    <div>
                                        <span style={{ color: '#888' }}>{t("Input mode:")}</span>{' '}
                                        {t(getInputModeButtons(inputDiagnostics.inputMode))}
                                    </div>

                                    <div>
                                        <span style={{ color: '#888' }}>{t("Input active:")}</span>{' '}
                                        {inputDiagnostics.leftTouchpadTouched ? t('Yes') : t('No')}
                                    </div>

                                    <div>
                                        <span style={{ color: '#888' }}>{t("Buttons pressed:")}</span>{' '}
                                        {inputDiagnostics.currentButtons && inputDiagnostics.currentButtons.length > 0
                                            ? inputDiagnostics.currentButtons.join(', ')
                                            : t('None')}
                                    </div>

                                    <div>
                                        <span style={{ color: '#888' }}>{t("Plugin State:")}</span>{' '}
                                        {!inputDiagnostics.inCooldown && !inputDiagnostics.waitingForRelease && !inputDiagnostics.overlayVisible ? t('Ready') : ''}
                                        {inputDiagnostics.inCooldown ? `${t('Cooldown')} ` : ''}
                                        {inputDiagnostics.waitingForRelease ? `${t('WaitRelease')} ` : ''}
                                        {inputDiagnostics.overlayVisible ? `${t('Overlay')} ` : ''}
                                    </div>

                                    <div>
                                        <span style={{ color: '#888' }}>{t("Timings:")}</span>{' '}
                                        {t('Hold:')}{inputDiagnostics.translateHoldTime}ms{' '}
                                        {t('Dismiss:')}{inputDiagnostics.dismissHoldTime}ms
                                    </div>
                                </div>

                                {!inputDiagnostics.healthy && inputDiagnostics.enabled && (
                                    <div style={{
                                        color: '#ff6b6b',
                                        fontWeight: 'bold',
                                        marginTop: '8px',
                                        padding: '6px',
                                        backgroundColor: 'rgba(255, 107, 107, 0.1)',
                                        borderRadius: '4px',
                                        fontSize: '11px'
                                    }}>
                                        {t("Input system is unhealthy - try toggling the plugin off/on")}
                                    </div>
                                )}
                            </div>
                        </Field>
                    </PanelSectionRow>
                )}
            </PanelSection>
        </div>
    );
};
