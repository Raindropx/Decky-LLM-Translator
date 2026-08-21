// src/SettingsContext.tsx
import React, { createContext, useCallback, useContext, useEffect, useReducer } from 'react';
import { call } from '@decky/api';
import { GameTranslatorLogic } from './Translator';
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
    refreshLlmEndpoints: () => Promise<void>;
    initialized: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

function buildLlmEndpointCacheKey(endpoint?: LLMEndpoint): string {
    if (!endpoint) return '';
    return JSON.stringify([
        endpoint.id,
        endpoint.provider,
        endpoint.baseUrl,
        endpoint.model,
        endpoint.visionEnabled,
        endpoint.temperature,
        endpoint.maxTokens,
        endpoint.enabled,
    ]);
}

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

    const applyLlmEndpoints = useCallback((endpoints: LLMEndpoint[], selectedId: string) => {
        dispatch({ type: 'UPDATE_SETTING', key: 'llmEndpoints', value: endpoints });
        dispatch({ type: 'UPDATE_SETTING', key: 'selectedLlmEndpointId', value: selectedId });
        const active = endpoints.find((endpoint) => endpoint.id === selectedId);
        logic.setHasSelectedLLMEndpoint(!!active && active.enabled);
        logic.setLlmEndpointCacheKey(buildLlmEndpointCacheKey(active));
    }, [logic]);

    const refreshLlmEndpoints = useCallback(async () => {
        const result = await call<[], { endpoints: LLMEndpoint[]; selectedEndpointId: string }>('get_llm_endpoints');
        applyLlmEndpoints(result?.endpoints ?? [], result?.selectedEndpointId ?? '');
    }, [applyLlmEndpoints]);

    // Load all settings at once
    const loadAllSettings = async () => {
        try {
            const serverSettings = await call<[], any>('get_all_settings');

            if (serverSettings) {

                // Map backend settings to frontend settings
                const mappedSettings: Partial<Settings> = {
                    pluginLanguage: normalizePluginLanguage(serverSettings.plugin_language),
                    inputLanguage: serverSettings.input_language,
                    targetLanguage: serverSettings.target_language,
                    customLanguages: serverSettings.custom_languages ?? [],
                    inputMode: serverSettings.input_mode,
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
                dispatch({ type: 'INITIALIZE_SETTINGS', settings: mappedSettings });

                // Update logic instance with settings
                logic.setInputLanguage(serverSettings.input_language);
                logic.setTargetLanguage(serverSettings.target_language);
                logic.setInputMode(serverSettings.input_mode);
                logic.setEnabled(serverSettings.enabled);
                logic.setHoldTimeTranslate(serverSettings.hold_time_translate);
                logic.setHoldTimeDismiss(serverSettings.hold_time_dismiss);
                logic.setConfidenceThreshold(serverSettings.confidence_threshold || 0.6); // Set in logic
                logic.setPauseGameOnOverlay(serverSettings.pause_game_on_overlay || false); // Set pause on overlay setting
                logic.setQuickToggleEnabled(serverSettings.quick_toggle_enabled || false); // Set quick toggle setting
                logger.setEnabled(serverSettings.debug_mode || false); // Set debug mode for logger
                logic.setPassthroughMode(serverSettings.passthrough_mode ?? false);
                logic.setTextBoxOpacity(serverSettings.text_box_opacity ?? 80);
                logic.setSteamScreenshotTranslationEnabled(
                    serverSettings.steam_screenshot_translation_enabled ?? true,
                );
                logic.setSteamScreenshotKeepOriginal(
                    serverSettings.steam_screenshot_keep_original ?? false,
                );

                // Set provider settings for upfront API key validation
                logic.setOcrProvider(serverSettings.ocr_provider || "chromescreenai");
                logic.setHasGoogleApiKey(!!serverSettings.google_api_key_configured);
                logic.setHasGeminiApiKey(!!serverSettings.gemini_api_key_configured);
                const activeEndpoint = (serverSettings.llm_endpoints ?? []).find(
                    (endpoint: LLMEndpoint) => endpoint.id === serverSettings.selected_llm_endpoint_id
                );
                logic.setHasSelectedLLMEndpoint(!!activeEndpoint && activeEndpoint.enabled);
                logic.setLlmEndpointCacheKey(buildLlmEndpointCacheKey(activeEndpoint));

                logic.setFontScale(serverSettings.font_scale ?? 1.0);
                logic.setGroupingPower(serverSettings.grouping_power ?? 0.25);
                logic.setTranslatedTextAlignment(serverSettings.translated_text_alignment ?? 'center');
                logic.setTranslatedTextFontFamily(serverSettings.translated_text_font_family ?? '');
                logic.setTranslatedTextFontStyle(serverSettings.translated_text_font_style ?? 'normal');
                logic.setHideIdenticalTranslations(serverSettings.hide_identical_translations ?? false);
                logic.setAllowLabelGrowth(serverSettings.allow_label_growth ?? false);

                logger.info('SettingsContext', 'All settings loaded successfully');
                logger.logObject('SettingsContext', 'Settings', mappedSettings);
            } else {
                logger.error('SettingsContext', 'Failed to load settings');
            }
        } catch (error) {
            logger.error('SettingsContext', 'Error loading settings', error);
        } finally {
            dispatch({ type: 'SET_INITIALIZED', initialized: true });
        }
    };

    // Update a single setting
    const updateSetting = async (key: keyof Settings, value: any, label?: string): Promise<boolean> => {
        const previousValue = settings[key];
        try {
            // Update local state
            const frontendValue = (key === 'googleApiKey' || key === 'geminiApiKey')
                ? (value ? 'configured' : '')
                : value;
            dispatch({ type: 'UPDATE_SETTING', key, value: frontendValue });

            // Map frontend setting key to backend setting key
            const backendKeyMap: Record<keyof Settings, string> = {
                pluginLanguage: 'plugin_language',
                inputLanguage: 'input_language',
                targetLanguage: 'target_language',
                customLanguages: 'custom_languages',
                inputMode: 'input_mode',
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

            // Update logic based on setting type
            switch (key) {
                case 'pluginLanguage':
                    setPluginLanguage(value);
                    break;
                case 'inputLanguage':
                    logic.setInputLanguage(value);
                    break;
                case 'targetLanguage':
                    logic.setTargetLanguage(value);
                    break;
                case 'inputMode':
                    logic.setInputMode(value);
                    break;
                case 'enabled':
                    logic.setEnabled(value);
                    break;
                case 'holdTimeTranslate':
                    logic.setHoldTimeTranslate(value);
                    break;
                case 'holdTimeDismiss':
                    logic.setHoldTimeDismiss(value);
                    break;
                case 'confidenceThreshold':
                    logic.setConfidenceThreshold(value);
                    break;
                case 'pauseGameOnOverlay':
                    logic.setPauseGameOnOverlay(value);
                    break;
                case 'quickToggleEnabled':
                    logic.setQuickToggleEnabled(value);
                    break;
                case 'debugMode':
                    logger.setEnabled(value);
                    break;
                case 'passthroughMode':
                    logic.setPassthroughMode(value);
                    break;
                case 'textBoxOpacity':
                    logic.setTextBoxOpacity(value);
                    break;
                case 'steamScreenshotTranslationEnabled':
                    logic.setSteamScreenshotTranslationEnabled(value);
                    break;
                case 'steamScreenshotKeepOriginal':
                    logic.setSteamScreenshotKeepOriginal(value);
                    break;
                case 'fontScale':
                    logic.setFontScale(value);
                    break;
                case 'groupingPower':
                    logic.setGroupingPower(value);
                    break;
                case 'translatedTextAlignment':
                    logic.setTranslatedTextAlignment(value);
                    break;
                case 'translatedTextFontFamily':
                    logic.setTranslatedTextFontFamily(value);
                    break;
                case 'translatedTextFontStyle':
                    logic.setTranslatedTextFontStyle(value);
                    break;
                case 'hideIdenticalTranslations':
                    logic.setHideIdenticalTranslations(value);
                    break;
                case 'allowLabelGrowth':
                    logic.setAllowLabelGrowth(value);
                    break;
                case 'ocrProvider':
                    logic.setOcrProvider(value);
                    break;
                case 'googleApiKey':
                    logic.setHasGoogleApiKey(!!value);
                    break;
                case 'geminiApiKey':
                    logic.setHasGeminiApiKey(!!value);
                    break;
            }

            // Save to backend
            const result = await call<[string, any], boolean>('set_setting', backendKey, value);

            if (result) {
                // if (label) logic.notify(`${label} updated successfully`);
                return true;
            } else {
                if (
                    key === 'pluginLanguage'
                    || key === 'customLanguages'
                    || key === 'targetLanguage'
                    || key === 'steamScreenshotTranslationEnabled'
                    || key === 'steamScreenshotKeepOriginal'
                ) {
                    dispatch({ type: 'UPDATE_SETTING', key, value: previousValue });
                }
                if (key === 'pluginLanguage') setPluginLanguage(previousValue as PluginLanguage);
                if (key === 'targetLanguage') logic.setTargetLanguage(previousValue as string);
                if (key === 'steamScreenshotTranslationEnabled') {
                    logic.setSteamScreenshotTranslationEnabled(previousValue as boolean);
                }
                if (key === 'steamScreenshotKeepOriginal') {
                    logic.setSteamScreenshotKeepOriginal(previousValue as boolean);
                }
                logic.notify(t('Failed to update {setting}', { setting: label || key }), 2000);
                return false;
            }
        } catch (error) {
            if (
                key === 'pluginLanguage'
                || key === 'customLanguages'
                || key === 'targetLanguage'
                || key === 'steamScreenshotTranslationEnabled'
                || key === 'steamScreenshotKeepOriginal'
            ) {
                dispatch({ type: 'UPDATE_SETTING', key, value: previousValue });
            }
            if (key === 'pluginLanguage') setPluginLanguage(previousValue as PluginLanguage);
            if (key === 'targetLanguage') logic.setTargetLanguage(previousValue as string);
            if (key === 'steamScreenshotTranslationEnabled') {
                logic.setSteamScreenshotTranslationEnabled(previousValue as boolean);
            }
            if (key === 'steamScreenshotKeepOriginal') {
                logic.setSteamScreenshotKeepOriginal(previousValue as boolean);
            }
            logger.error('SettingsContext', `Failed to update ${key}`, error);
            logic.notify(t('Failed to update {setting}', { setting: label || key }), 2000);
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
