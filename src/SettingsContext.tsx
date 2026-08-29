// src/SettingsContext.tsx
import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';
import { call } from '@decky/api';
import { GameTranslatorLogic, isRuntimeSettingsSnapshot } from './Translator';
import type { RuntimeSettingsSnapshot } from './Translator';
import { InputMode } from './Input';
import { logger } from './Logger';
import type { LLMEndpoint } from './LLMEndpoints';
import { normalizePluginLanguage, PluginLanguage, setPluginLanguage, t } from './i18n';

export interface CustomLanguage {
    alias: string;
    definition: string;
}

// Define the settings interface
export interface Settings {
    pluginLanguage: PluginLanguage;
    inputLanguage: string;
    targetLanguage: string;
    customLanguages: CustomLanguage[];
    inputMode: InputMode;
    askAIInputMode: InputMode;
    enabled: boolean;
    initialized: boolean;
    holdTimeTranslate: number;
    holdTimeDismiss: number;
    confidenceThreshold: number; // New setting for confidence threshold
    rapidocrConfidence: number; // RapidOCR-specific confidence threshold (0.0-1.0)
    rapidocrBoxThresh: number; // RapidOCR box detection threshold (0.0-1.0)
    rapidocrUnclipRatio: number; // RapidOCR box expansion ratio (1.0-3.0)
    rapidocrPersistentMode: boolean; // Keep RapidOCR worker alive between requests
    chromeScreenAiPersistentMode: boolean; // Keep Chrome Screen AI worker alive between requests
    pauseGameOnOverlay: boolean; // Setting to control pausing game when overlay is shown
    quickToggleEnabled: boolean; // Quick toggle overlay with right button in combo modes
    ocrProvider: 'rapidocr' | 'ocrspace' | 'googlecloud' | 'legacy_gemini_vision' | 'chromescreenai'; // OCR provider
    googleApiKey: string; // Google Cloud Vision API key for text recognition
    geminiApiKey: string; // Write-only key status for the legacy combined Gemini mode
    geminiModel: string; // Gemini model to use
    debugMode: boolean; // Debug mode for verbose console logging
    passthroughMode: boolean; // Show live game content behind translated labels
    passthroughAlwaysOnTop: boolean; // Keep passthrough labels above Steam UI
    textBoxOpacity: number; // Passthrough label background opacity (0-100)
    steamScreenshotTranslationEnabled: boolean; // Composite visible translations into STEAM+R1 screenshots
    steamScreenshotKeepOriginal: boolean; // Preserve native screenshot and create translated copy
    fontScale: number; // Overlay font scale multiplier for external monitors
    groupingPower: number; // Text grouping aggressiveness (0.25 normal - 1.0 huge)
    translatedTextAlignment: 'left' | 'right' | 'center' | 'justify';
    translatedTextFontFamily: string;
    translatedTextFontStyle: 'normal' | 'bold' | 'italic' | 'bolditalic';
    hideIdenticalTranslations: boolean;
    allowLabelGrowth: boolean;
    customRecognitionSettings: boolean;
    llmEndpoints: LLMEndpoint[];
    selectedLlmEndpointId: string;
}

// Define action types
type SettingsAction =
    | { type: 'INITIALIZE_SETTINGS', settings: Partial<Settings> }
    | { type: 'UPDATE_SETTING', key: keyof Settings, value: any }
    | { type: 'SET_INITIALIZED', initialized: boolean };

// Define the initial state
const initialSettings: Settings = {
    pluginLanguage: "system",
    inputLanguage: "",
    targetLanguage: "",
    customLanguages: [],
    inputMode: InputMode.L5_BUTTON,  // Default to L5 back button
    askAIInputMode: InputMode.R5_BUTTON,
    enabled: true,
    initialized: false,
    holdTimeTranslate: 1000, // Default to 1 second (1000ms)
    holdTimeDismiss: 500,    // Default to 0.5 seconds (500ms)
    confidenceThreshold: 0.6, // Default confidence threshold
    rapidocrConfidence: 0.5, // Default RapidOCR confidence threshold (0.0-1.0)
    rapidocrBoxThresh: 0.5, // Default RapidOCR box detection threshold (0.0-1.0)
    rapidocrUnclipRatio: 1.6, // Default RapidOCR box expansion ratio (1.0-3.0)
    rapidocrPersistentMode: false,
    chromeScreenAiPersistentMode: false,
    pauseGameOnOverlay: false, // Default to not pausing game
    quickToggleEnabled: false, // Default to disabled
    ocrProvider: "chromescreenai", // Default to chromescreenai (Chrome Screen AI) provider
    googleApiKey: "", // Empty by default, only needed for Google Cloud
    geminiApiKey: "", // Empty by default, needed only for the legacy combined mode
    geminiModel: "gemini-2.5-flash", // Default Gemini model
    debugMode: false, // Debug mode off by default
    passthroughMode: false,
    passthroughAlwaysOnTop: false,
    textBoxOpacity: 80,
    steamScreenshotTranslationEnabled: true,
    steamScreenshotKeepOriginal: false,
    fontScale: 1.0,
    groupingPower: 0.25,
    translatedTextAlignment: 'center',
    translatedTextFontFamily: '',
    translatedTextFontStyle: 'normal',
    hideIdenticalTranslations: false,
    allowLabelGrowth: false,
    customRecognitionSettings: false,
    llmEndpoints: [],
    selectedLlmEndpointId: '',
};

// Create the reducer
function settingsReducer(state: Settings, action: SettingsAction): Settings {
    switch (action.type) {
        case 'INITIALIZE_SETTINGS':
            return { ...state, ...action.settings };
        case 'UPDATE_SETTING':
            return { ...state, [action.key]: action.value };
        case 'SET_INITIALIZED':
            return { ...state, initialized: action.initialized };
        default:
            return state;
    }
}

// Create the context
interface SettingsContextType {
    settings: Settings;
    updateSetting: (key: keyof Settings, value: any, label?: string) => Promise<boolean>;
    updateLanguageSettings: (
        customLanguages: CustomLanguage[],
        targetLanguage: string,
    ) => Promise<boolean>;
    refreshLlmEndpoints: () => Promise<void>;
    initialized: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

// Create the provider component
interface SettingsProviderProps {
    children: React.ReactNode;
    logic: GameTranslatorLogic;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({
                                                                      children,
                                                                      logic
                                                                  }) => {
    const [settings, dispatch] = useReducer(settingsReducer, initialSettings);
    const settingsRef = useRef(settings);
    const settingUpdateVersionsRef = useRef<Partial<Record<keyof Settings, number>>>({});

    const applyLlmEndpoints = useCallback((endpoints: LLMEndpoint[], selectedId: string) => {
        settingsRef.current = {
            ...settingsRef.current,
            llmEndpoints: endpoints,
            selectedLlmEndpointId: selectedId,
        };
        dispatch({ type: 'UPDATE_SETTING', key: 'llmEndpoints', value: endpoints });
        dispatch({ type: 'UPDATE_SETTING', key: 'selectedLlmEndpointId', value: selectedId });
        logic.setLlmEndpoints(endpoints, selectedId);
    }, [logic]);

    const refreshLlmEndpoints = useCallback(async () => {
        const result = await call<[], { endpoints: LLMEndpoint[]; selectedEndpointId: string }>('get_llm_endpoints');
        applyLlmEndpoints(result?.endpoints ?? [], result?.selectedEndpointId ?? '');
    }, [applyLlmEndpoints]);

    // Load all settings at once
    const loadAllSettings = async () => {
        try {
            let serverSettings: (RuntimeSettingsSnapshot & Record<string, any>) | null = null;
            const maxAttempts = 5;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    const candidate = await call<[], unknown>('get_all_settings');
                    if (isRuntimeSettingsSnapshot(candidate)) {
                        serverSettings = candidate as RuntimeSettingsSnapshot & Record<string, any>;
                        break;
                    }

                    logger.warn('SettingsContext', `Settings were not ready (attempt ${attempt}/${maxAttempts})`);
                } catch (error) {
                    logger.error('SettingsContext', `Failed to load settings (attempt ${attempt}/${maxAttempts})`, error);
                }

                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 250));
                }
            }

            if (serverSettings) {

                // Map backend settings to frontend settings
                const mappedSettings: Partial<Settings> = {
                    pluginLanguage: normalizePluginLanguage(serverSettings.plugin_language),
                    inputLanguage: serverSettings.input_language,
                    targetLanguage: serverSettings.target_language,
                    customLanguages: serverSettings.custom_languages ?? [],
                    inputMode: serverSettings.input_mode,
                    askAIInputMode: serverSettings.ask_ai_input_mode,
                    enabled: serverSettings.enabled,
                    holdTimeTranslate: serverSettings.hold_time_translate,
                    holdTimeDismiss: serverSettings.hold_time_dismiss,
                    confidenceThreshold: serverSettings.confidence_threshold || 0.6, // Add default if not present
                    rapidocrConfidence: serverSettings.rapidocr_confidence ?? 0.5, // RapidOCR confidence (0.0-1.0)
                    rapidocrBoxThresh: serverSettings.rapidocr_box_thresh ?? 0.5, // RapidOCR box threshold (0.0-1.0)
                    rapidocrUnclipRatio: serverSettings.rapidocr_unclip_ratio ?? 1.6, // RapidOCR unclip ratio (1.0-3.0)
                    rapidocrPersistentMode: serverSettings.rapidocr_persistent_mode ?? false,
                    chromeScreenAiPersistentMode: serverSettings.chromescreenai_persistent_mode ?? false,
                    pauseGameOnOverlay: serverSettings.pause_game_on_overlay || false, // Add default if not present
                    quickToggleEnabled: serverSettings.quick_toggle_enabled || false, // Add default if not present
                    ocrProvider: serverSettings.ocr_provider || "chromescreenai", // OCR provider setting
                    googleApiKey: serverSettings.google_api_key_configured ? "configured" : "",
                    geminiApiKey: serverSettings.gemini_api_key_configured ? "configured" : "",
                    geminiModel: serverSettings.gemini_model || "gemini-2.5-flash",
                    debugMode: serverSettings.debug_mode || false,
                    passthroughMode: serverSettings.passthrough_mode ?? false,
                    passthroughAlwaysOnTop: serverSettings.passthrough_always_on_top ?? false,
                    textBoxOpacity: serverSettings.text_box_opacity ?? 80,
                    steamScreenshotTranslationEnabled: serverSettings.steam_screenshot_translation_enabled ?? true,
                    steamScreenshotKeepOriginal: serverSettings.steam_screenshot_keep_original ?? false,
                    fontScale: serverSettings.font_scale ?? 1.0,
                    groupingPower: serverSettings.grouping_power ?? 0.25,
                    translatedTextAlignment: serverSettings.translated_text_alignment ?? 'center',
                    translatedTextFontFamily: serverSettings.translated_text_font_family ?? '',
                    translatedTextFontStyle: serverSettings.translated_text_font_style ?? 'normal',
                    hideIdenticalTranslations: serverSettings.hide_identical_translations ?? false,
                    allowLabelGrowth: serverSettings.allow_label_growth ?? false,
                    customRecognitionSettings: serverSettings.custom_recognition_settings ?? false,
                    llmEndpoints: serverSettings.llm_endpoints ?? [],
                    selectedLlmEndpointId: serverSettings.selected_llm_endpoint_id ?? '',
                };

                setPluginLanguage(mappedSettings.pluginLanguage ?? 'system');

                // Update settings in context
                settingsRef.current = { ...settingsRef.current, ...mappedSettings };
                dispatch({ type: 'INITIALIZE_SETTINGS', settings: mappedSettings });

                // Keep the runtime logic synchronized even when this panel is the
                // first frontend component Decky mounts after plugin startup.
                logic.applyRuntimeSettings(serverSettings);

                logger.info('SettingsContext', 'All settings loaded successfully');
                logger.logObject('SettingsContext', 'Settings', mappedSettings);
            } else {
                logger.error('SettingsContext', 'Failed to load settings');
            }
        } catch (error) {
            logger.error('SettingsContext', 'Error loading settings', error);
        } finally {
            settingsRef.current = { ...settingsRef.current, initialized: true };
            dispatch({ type: 'SET_INITIALIZED', initialized: true });
        }
    };

    const applySettingLocally = useCallback((key: keyof Settings, frontendValue: any, logicValue = frontendValue) => {
        settingsRef.current = { ...settingsRef.current, [key]: frontendValue };
        dispatch({ type: 'UPDATE_SETTING', key, value: frontendValue });

        switch (key) {
            case 'pluginLanguage':
                setPluginLanguage(logicValue);
                break;
            case 'inputLanguage':
                logic.setInputLanguage(logicValue);
                break;
            case 'targetLanguage':
                logic.setTargetLanguage(logicValue);
                break;
            case 'inputMode':
                logic.setInputMode(logicValue);
                break;
            case 'askAIInputMode':
                logic.setAskAIInputMode(logicValue);
                break;
            case 'enabled':
                logic.setEnabled(logicValue);
                break;
            case 'holdTimeTranslate':
                logic.setHoldTimeTranslate(logicValue);
                break;
            case 'holdTimeDismiss':
                logic.setHoldTimeDismiss(logicValue);
                break;
            case 'confidenceThreshold':
                logic.setConfidenceThreshold(logicValue);
                break;
            case 'pauseGameOnOverlay':
                logic.setPauseGameOnOverlay(logicValue);
                break;
            case 'quickToggleEnabled':
                logic.setQuickToggleEnabled(logicValue);
                break;
            case 'debugMode':
                logger.setEnabled(logicValue);
                break;
            case 'passthroughMode':
                logic.setPassthroughMode(logicValue);
                break;
            case 'passthroughAlwaysOnTop':
                logic.setPassthroughAlwaysOnTop(logicValue);
                break;
            case 'textBoxOpacity':
                logic.setTextBoxOpacity(logicValue);
                break;
            case 'steamScreenshotTranslationEnabled':
                logic.setSteamScreenshotTranslationEnabled(logicValue);
                break;
            case 'steamScreenshotKeepOriginal':
                logic.setSteamScreenshotKeepOriginal(logicValue);
                break;
            case 'fontScale':
                logic.setFontScale(logicValue);
                break;
            case 'groupingPower':
                logic.setGroupingPower(logicValue);
                break;
            case 'translatedTextAlignment':
                logic.setTranslatedTextAlignment(logicValue);
                break;
            case 'translatedTextFontFamily':
                logic.setTranslatedTextFontFamily(logicValue);
                break;
            case 'translatedTextFontStyle':
                logic.setTranslatedTextFontStyle(logicValue);
                break;
            case 'hideIdenticalTranslations':
                logic.setHideIdenticalTranslations(logicValue);
                break;
            case 'allowLabelGrowth':
                logic.setAllowLabelGrowth(logicValue);
                break;
            case 'ocrProvider':
                logic.setOcrProvider(logicValue);
                break;
            case 'googleApiKey':
                logic.setHasGoogleApiKey(!!logicValue);
                break;
            case 'geminiApiKey':
                logic.setHasGeminiApiKey(!!logicValue);
                break;
        }
    }, [logic]);

    // Update a single setting
    const updateSetting = async (key: keyof Settings, value: any, label?: string): Promise<boolean> => {
        if (
            (key === 'inputMode' && value === settingsRef.current.askAIInputMode)
            || (key === 'askAIInputMode' && value === settingsRef.current.inputMode)
        ) {
            logic.notify(t('Ask AI shortcut must be different from the translation shortcut'), 2500);
            return false;
        }

        const previousValue = settingsRef.current[key];
        const updateVersion = (settingUpdateVersionsRef.current[key] ?? 0) + 1;
        settingUpdateVersionsRef.current[key] = updateVersion;
        const rollbackIfCurrent = () => {
            if (settingUpdateVersionsRef.current[key] === updateVersion) {
                applySettingLocally(key, previousValue);
            }
        };
        try {
            // Update local state
            const frontendValue = (key === 'googleApiKey' || key === 'geminiApiKey')
                ? (value ? 'configured' : '')
                : value;
            applySettingLocally(key, frontendValue, value);

            // Map frontend setting key to backend setting key
            const backendKeyMap: Record<keyof Settings, string> = {
                pluginLanguage: 'plugin_language',
                inputLanguage: 'input_language',
                targetLanguage: 'target_language',
                customLanguages: 'custom_languages',
                inputMode: 'input_mode',
                askAIInputMode: 'ask_ai_input_mode',
                enabled: 'enabled',
                initialized: 'initialized',
                holdTimeTranslate: 'hold_time_translate',
                holdTimeDismiss: 'hold_time_dismiss',
                confidenceThreshold: 'confidence_threshold',
                rapidocrConfidence: 'rapidocr_confidence',
                rapidocrBoxThresh: 'rapidocr_box_thresh',
                rapidocrUnclipRatio: 'rapidocr_unclip_ratio',
                rapidocrPersistentMode: 'rapidocr_persistent_mode',
                chromeScreenAiPersistentMode: 'chromescreenai_persistent_mode',
                pauseGameOnOverlay: 'pause_game_on_overlay',
                quickToggleEnabled: 'quick_toggle_enabled',
                ocrProvider: 'ocr_provider',
                googleApiKey: 'google_api_key',
                geminiApiKey: 'gemini_api_key',
                geminiModel: 'gemini_model',
                debugMode: 'debug_mode',
                passthroughMode: 'passthrough_mode',
                passthroughAlwaysOnTop: 'passthrough_always_on_top',
                textBoxOpacity: 'text_box_opacity',
                steamScreenshotTranslationEnabled: 'steam_screenshot_translation_enabled',
                steamScreenshotKeepOriginal: 'steam_screenshot_keep_original',
                fontScale: 'font_scale',
                groupingPower: 'grouping_power',
                translatedTextAlignment: 'translated_text_alignment',
                translatedTextFontFamily: 'translated_text_font_family',
                translatedTextFontStyle: 'translated_text_font_style',
                hideIdenticalTranslations: 'hide_identical_translations',
                allowLabelGrowth: 'allow_label_growth',
                customRecognitionSettings: 'custom_recognition_settings',
                llmEndpoints: 'llm_endpoints',
                selectedLlmEndpointId: 'selected_llm_endpoint_id'
            };

            // Skip settings that don't need to be saved to backend
            if (key === 'initialized') return true;

            const backendKey = backendKeyMap[key];

            // Save to backend
            const result = await call<[string, any], boolean>('set_setting', backendKey, value);

            if (result) {
                // if (label) logic.notify(`${label} updated successfully`);
                return true;
            } else {
                rollbackIfCurrent();
                logic.notify(t('Failed to update {setting}', { setting: label || key }), 2000);
                return false;
            }
        } catch (error) {
            rollbackIfCurrent();
            logger.error('SettingsContext', `Failed to update ${key}`, error);
            logic.notify(t('Failed to update {setting}', { setting: label || key }), 2000);
            return false;
        }
    };

    const updateLanguageSettings = async (
        customLanguages: CustomLanguage[],
        targetLanguage: string,
    ): Promise<boolean> => {
        try {
            const result = await call<
                [CustomLanguage[], string],
                {
                    success: boolean;
                    custom_languages?: CustomLanguage[];
                    target_language?: string;
                }
            >('set_language_settings', customLanguages, targetLanguage);
            if (!result?.success) {
                logic.notify(t('Failed to update {setting}', { setting: 'Custom languages' }), 2000);
                return false;
            }

            applySettingLocally(
                'customLanguages',
                result.custom_languages ?? customLanguages,
            );
            applySettingLocally(
                'targetLanguage',
                result.target_language ?? targetLanguage,
            );
            return true;
        } catch (error) {
            logger.error('SettingsContext', 'Failed to update custom languages', error);
            logic.notify(t('Failed to update {setting}', { setting: 'Custom languages' }), 2000);
            return false;
        }
    };

    // Initialize settings on mount
    useEffect(() => {
        loadAllSettings();
    }, []);

    return (
        <SettingsContext.Provider value={{
            settings,
            updateSetting,
            updateLanguageSettings,
            refreshLlmEndpoints,
            initialized: settings.initialized
        }}>
            {children}
        </SettingsContext.Provider>
    );
};

// Create a hook for using the settings
export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};
