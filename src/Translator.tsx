// Translator.tsx - Handles translator logic and API interactions

import { call, toaster } from "@decky/api";
import { Router } from "@decky/ui";
import { TextRecognizer, NetworkError, ApiKeyError, RateLimitError, ModelNotAvailableError, LLMError } from "./TextRecognizer";
import { TextTranslator } from "./TextTranslator";
import { Input, InputMode, ActionType, ProgressInfo } from "./Input";
import { ImageState } from "./Overlay";
import { logger } from "./Logger";
import { LastTranslationCache } from "./TranslationCache";
import {
    renderTranslatedSteamScreenshot,
    SteamScreenshotResponse,
} from "./SteamScreenshot";
import { t } from "./i18n";

// Screenshot response interface
export interface ScreenshotResponse {
    path: string;
    base64: string;
}

// Main app logic
export class GameTranslatorLogic {
    private isProcessing = false;
    public imageState: ImageState;
    private textRecognizer: TextRecognizer;
    private textTranslator: TextTranslator;
    private translationCache = new LastTranslationCache();
    private llmEndpointCacheKey = "";
    private shortcutInput: Input; // Added shortcut input handler
    private progressListeners: Array<(progressInfo: ProgressInfo) => void> = [];
    private enabled: boolean = true; // Add enabled state
    private confidenceThreshold: number = 0.6; // Default confidence threshold
    private pauseGameOnOverlay: boolean = false;
    private passthroughMode: boolean = false;
    private hideIdenticalTranslations: boolean = false;
    private currentRunId: number = 0;
    private steamScreenshotAnnotationInProgress = false;
    private steamScreenshotTranslationEnabled = true;
    private steamScreenshotKeepOriginal = false;

    // Provider settings for upfront validation
    private ocrProvider: string = "rapidocr";
    private hasGoogleApiKey: boolean = false;
    private hasGeminiApiKey: boolean = false;
    private hasSelectedLLMEndpoint: boolean = false;

    isOverlayVisible(): boolean {
        return this.imageState.isVisible();
    }

    // Add public access to shortcutInput for diagnostics
    public get shortcutInputHandler(): Input {
        return this.shortcutInput;
    }

    constructor(imageState: ImageState) {
        this.imageState = imageState;
        this.textRecognizer = new TextRecognizer();
        this.textTranslator = new TextTranslator();

        // Initialize for hidraw-based button detection
        this.shortcutInput = new Input();

        // Set up listener for translate, dismiss, and toggle actions
        this.shortcutInput.onShortcutPressed((actionType: ActionType) => {
            // Only process inputs if the plugin is enabled
            if (!this.enabled) return;

            if (actionType === ActionType.DISMISS) {
                this.dismiss();
            } else if (actionType === ActionType.TOGGLE_TRANSLATIONS) {
                // Toggle translations action
                if (this.imageState.isVisible() && !this.imageState.isLoading()) {
                    logger.debug('Translator', 'Toggling translation visibility');
                    this.imageState.toggleTranslationsVisibility();
                }
            } else {
                // Translate action
                if (this.imageState.isVisible()) return;
                if (this.isProcessing) return;
                if (!this.canStartTranslation()) return;

                // Pause first so the game freezes before the screenshot
                if (this.shouldPauseGameForOverlay()) {
                    this.pauseCurrentGame().catch(err => logger.error('Translator', 'Pause failed', err));
                }
                this.takeScreenshotAndTranslate().catch(err => logger.error('Translator', 'Screenshot failed', err));
            }
        });

        this.shortcutInput.onSteamScreenshotPressed(() => {
            this.annotateSteamScreenshot().catch(error => {
                logger.error('Translator', 'Steam screenshot annotation failed', error);
            });
        });

        imageState.onStateChanged((visible, _, __, ___, ____, _____, ______, _______, ________) => {
            this.shortcutInput.setOverlayVisible(visible);

            if (!this.enabled) return;

            if (this.shouldPauseGameForOverlay() && !visible) {
                this.resumeCurrentGame();
            }
        });

        // Set up progress listener
        this.shortcutInput.onProgress((progressInfo: ProgressInfo) => {
            this.notifyProgressListeners(progressInfo);
        });

        // Load enabled state from server
        this.loadInitialState();
    }

    // Load initial state from server
    private async loadInitialState() {
        try {
            const result = await call<[], boolean>('get_enabled_state');
            this.enabled = !!result;
            logger.info('Translator', `Loaded initial enabled state: ${this.enabled}`);

            if (this.shortcutInput) {
                this.shortcutInput.setEnabled(this.enabled);
            }

            // If plugin starts disabled, stop the hidraw monitor that was auto-started
            if (!this.enabled) {
                logger.info('Translator', 'Plugin is disabled on startup, stopping hidraw monitor');
                call('stop_hidraw_monitor').catch(error => {
                    logger.error('Translator', 'Failed to stop hidraw monitor on startup', error);
                });
            }
        } catch (error) {
            logger.error('Translator', 'Failed to load initial state', error);
        }
    }

    // Add method to enable/disable the plugin
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;

        if (this.shortcutInput) {
            this.shortcutInput.setEnabled(enabled);
        }

        // Save to server settings file
        call('set_setting', 'enabled', enabled).catch(error => {
            logger.error('Translator', 'Failed to save enabled state to server', error);
        });

        if (!enabled) {
            this.dismiss();
        }

        // Stop or start the backend hidraw monitor based on enabled state
        if (enabled) {
            // Re-start hidraw monitor when re-enabling
            call('start_hidraw_monitor').then(result => {
                logger.info('Translator', `Hidraw monitor start result: ${JSON.stringify(result)}`);
            }).catch(error => {
                logger.error('Translator', 'Failed to start hidraw monitor', error);
            });
        } else {
            // Stop hidraw monitor when disabling to save resources
            call('stop_hidraw_monitor').then(result => {
                logger.info('Translator', `Hidraw monitor stop result: ${JSON.stringify(result)}`);
            }).catch(error => {
                logger.error('Translator', 'Failed to stop hidraw monitor', error);
            });
        }
    }

    // Add method to get enabled state
    isEnabled(): boolean {
        return this.enabled;
    }

    // Method to get full diagnostic information
    getInputDiagnostics(): object | null {
        if (!this.shortcutInput) return null;
        return this.shortcutInput.getDiagnostics();
    }

    // New methods for confidence threshold
    setConfidenceThreshold(threshold: number): void {
        logger.debug('Translator', `Setting confidence threshold to: ${threshold}`);
        this.confidenceThreshold = threshold;

        // Update the textRecognizer with the new threshold
        this.textRecognizer.setConfidenceThreshold(threshold);
    }

    getConfidenceThreshold(): number {
        return this.confidenceThreshold;
    }

    setGroupingPower = (power: number): void => {
        this.textRecognizer.setGroupingPower(power);
    }

    setHideIdenticalTranslations = (enabled: boolean): void => {
        this.hideIdenticalTranslations = enabled;
    }

    setPauseGameOnOverlay = (enabled: boolean): void => {
        logger.debug('Translator', `Setting pauseGameOnOverlay to: ${enabled}`);
        this.pauseGameOnOverlay = enabled;

        if (this.imageState.isVisible()) {
            if (this.shouldPauseGameForOverlay()) {
                this.pauseCurrentGame();
            } else {
                this.resumeCurrentGame();
            }
        }
    }

    private shouldPauseGameForOverlay = (): boolean => {
        return this.pauseGameOnOverlay && !this.passthroughMode;
    }

    setPassthroughMode = (enabled: boolean): void => {
        const wasPausing = this.shouldPauseGameForOverlay();
        this.passthroughMode = enabled;
        this.imageState.setPassthroughMode(enabled);

        if (this.imageState.isVisible() && wasPausing !== this.shouldPauseGameForOverlay()) {
            if (this.shouldPauseGameForOverlay()) {
                this.pauseCurrentGame();
            } else {
                this.resumeCurrentGame();
            }
        }
    }

    // Method to get pause game on overlay state
    getPauseGameOnOverlay = (): boolean => {
        return this.pauseGameOnOverlay;
    }

    // Method to pause the current game
    async pauseCurrentGame(): Promise<void> {
        try {
            // Get the current running app ID
            const mainApp = Router.MainRunningApp;
            if (!mainApp || !mainApp.appid) {
                logger.debug('Translator', 'No game running to pause');
                return;
            }

            // Use the pid_from_appid function to get the process ID
            const pid = await call<[number], number>('pid_from_appid', Number(mainApp.appid));

            if (pid) {
                logger.info('Translator', `Pausing game with appid ${mainApp.appid}, pid ${pid}`);

                // Call the pause function in the backend
                const pauseResult = await call<[number], boolean>('pause', pid);
                if (pauseResult) {
                    logger.info('Translator', 'Game paused successfully');
                } else {
                    logger.error('Translator', 'Failed to pause game');
                }
            } else {
                logger.error('Translator', 'Failed to get PID for game');
            }
        } catch (error) {
            logger.error('Translator', 'Error pausing game', error);
        }
    }

    // Method to resume the current game
    async resumeCurrentGame(): Promise<void> {
        try {
            // Get the current running app ID
            const mainApp = Router.MainRunningApp;
            if (!mainApp || !mainApp.appid) {
                logger.debug('Translator', 'No game running to resume');
                return;
            }

            // Use the pid_from_appid function to get the process ID
            const pid = await call<[number], number>('pid_from_appid', Number(mainApp.appid));

            if (pid) {
                logger.info('Translator', `Resuming game with appid ${mainApp.appid}, pid ${pid}`);

                // Call the resume function in the backend
                const resumeResult = await call<[number], boolean>('resume', pid);
                if (resumeResult) {
                    logger.info('Translator', 'Game resumed successfully');
                } else {
                    logger.error('Translator', 'Failed to resume game');
                }
            } else {
                logger.error('Translator', 'Failed to get PID for game');
            }
        } catch (error) {
            logger.error('Translator', 'Error resuming game', error);
        }
    }

    // Methods for progress indicator
    onProgress(callback: (progressInfo: ProgressInfo) => void): void {
        this.progressListeners.push(callback);
    }

    offProgress(callback: (progressInfo: ProgressInfo) => void): void {
        const index = this.progressListeners.indexOf(callback);
        if (index !== -1) {
            this.progressListeners.splice(index, 1);
        }
    }

    private notifyProgressListeners(progressInfo: ProgressInfo): void {
        for (const callback of this.progressListeners) {
            callback(progressInfo);
        }
    }

    // Clean up resources when plugin is unmounted
    cleanup(): void {
        if (this.shortcutInput) {
            this.shortcutInput.unregister();
        }

        // Stop backend hidraw monitor
        call('stop_hidraw_monitor').catch(error => {
            logger.error('Translator', 'Failed to stop hidraw monitor', error);
        });
    }

    notify = async (message: string, duration: number = 1000, body?: string): Promise<void> => {
        toaster.toast({
            title: t(message),
            body: t(body || message),
            duration: duration,
            critical: true
        });
    }

    dismiss = (): void => {
        this.currentRunId++;
        this.isProcessing = false;
        if (this.imageState.isVisible()) {
            this.imageState.hideImage();
            this.shortcutInput.setOverlayVisible(false);
        }
    }

    takeScreenshotAndTranslate = async (): Promise<void> => {
        // If already processing or disabled, return
        if (this.isProcessing || !this.enabled) {
            logger.debug('Translator', 'Already processing a screenshot or plugin disabled, skipping');
            return;
        }

        if (!this.canStartTranslation()) return;

        const runId = ++this.currentRunId;
        const isCancelled = (): boolean => runId !== this.currentRunId;

        try {
            this.isProcessing = true;

            // Take screenshot FIRST while screen is clean (no overlay visible)
            const appName = Router.MainRunningApp?.display_name || "";
            logger.info('Translator', `Taking new screenshot for: ${appName}`);
            const result = await call<[string], ScreenshotResponse>('take_screenshot', appName);

            if (isCancelled()) {
                logger.debug('Translator', 'Translation cancelled before screenshot processed');
                return;
            }

            if (!result || !result.path || !result.base64) {
                logger.warn('Translator', 'Screenshot capture failed, not opening overlay');
                this.notify('Screen capture failed', 2500, 'Try pressing the shortcut again');
                return;
            }

            logger.debug('Translator', `Screenshot captured, path: ${result.path}, base64 length: ${result.base64.length}`);

            this.imageState.startLoading("Processing");
            this.imageState.showImage(result.base64);
            const recognizingStep = this.ocrProvider === 'legacy_gemini_vision'
                ? "Recognizing and Translating"
                : "Recognizing";
            this.imageState.updateProcessingStep(recognizingStep, false, this.ocrMethodHint());

            const textRegions = await this.textRecognizer.recognizeTextFile(result.path);
            if (isCancelled()) {
                logger.debug('Translator', 'Translation cancelled after OCR');
                return;
            }
            logger.info('Translator', `Found ${textRegions.length} text regions`);

            if (textRegions.length > 0) {
                const alreadyTranslated = textRegions.every(r => r.translatedText);
                let translatedRegions = alreadyTranslated
                    ? null
                    : this.translationCache.get(textRegions);

                if (translatedRegions) {
                    logger.info('Translator', `Translation cache hit: ${translatedRegions.length} regions`);
                } else {
                    const cacheRevision = this.translationCache.getRevision();
                    if (!alreadyTranslated) {
                        this.imageState.updateProcessingStep("Translating text", false, this.translationMethodHint());
                    }

                    // Legacy vision regions are already translated; normal OCR regions call the selected LLM.
                    translatedRegions = await this.textTranslator.translateText(textRegions, result.base64);
                    if (isCancelled()) {
                        logger.debug('Translator', 'Translation cancelled after translation step');
                        return;
                    }
                    logger.info('Translator', `Translation complete: ${translatedRegions.length} regions`);

                    if (!alreadyTranslated && this.textTranslator.wasLastTranslationSuccessful()) {
                        if (this.translationCache.store(textRegions, translatedRegions, cacheRevision)) {
                            logger.debug('Translator', `Stored translation cache entry for ${textRegions.length} regions`);
                        } else {
                            logger.warn('Translator', 'Translation result was not cacheable because settings changed or region counts differed');
                        }
                    }
                }

                if (this.hideIdenticalTranslations) {
                    const before = translatedRegions.length;
                    translatedRegions = translatedRegions.filter(r =>
                        r.translatedText.trim().toLowerCase() !== r.text.trim().toLowerCase()
                    );
                    if (translatedRegions.length < before) {
                        logger.info('Translator', `Filtered ${before - translatedRegions.length} identical translations`);
                    }
                }

                this.imageState.showTranslatedImage(result.base64, translatedRegions);
            } else {
                // No text found, show message
                this.imageState.updateProcessingStep("No text found");

                // Hide overlay after a short delay
                setTimeout(() => {
                    this.imageState.hideImage();
                }, 2000); // 2 seconds delay
            }
        } catch (error) {
            if (isCancelled()) {
                logger.debug('Translator', 'Translation cancelled, suppressing error UI', error);
                return;
            }

            logger.error('Translator', 'Screenshot and translation error', error);

            // Check if this is a network error
            if (error instanceof NetworkError) {
                const msg = error.message || "No internet connection";
                this.imageState.updateProcessingStep(msg, true);
                // Hide overlay after showing the error message
                setTimeout(() => {
                    this.imageState.hideImage();
                }, 2500); // 2.5 seconds delay for network error
            } else if (error instanceof ApiKeyError) {
                this.imageState.updateProcessingStep(error.message || "Invalid API key", true);
                // Hide overlay after showing the error message
                setTimeout(() => {
                    this.imageState.hideImage();
                }, 2500); // 2.5 seconds delay for API key error
            } else if (error instanceof ModelNotAvailableError) {
                this.imageState.updateProcessingStep(error.message, true);
                setTimeout(() => {
                    this.imageState.hideImage();
                }, 3000);
            } else if (error instanceof RateLimitError) {
                this.imageState.updateProcessingStep(error.message, true);
                // Hide overlay after showing the error message
                setTimeout(() => {
                    this.imageState.hideImage();
                }, 3000); // 3 seconds delay for rate limit error
            } else if (error instanceof LLMError) {
                this.imageState.updateProcessingStep(error.message, true);
                setTimeout(() => this.imageState.hideImage(), 3000);
            } else {
                this.imageState.hideImage();
            }
        }
        finally {
            if (!isCancelled()) {
                this.isProcessing = false;
            }
        }
    }

    private annotateSteamScreenshot = async (): Promise<void> => {
        const snapshot = this.imageState.getScreenshotOverlaySnapshot();
        if (
            !this.enabled
            || !this.steamScreenshotTranslationEnabled
            || !this.imageState.isVisible()
            || snapshot.loading
            || !snapshot.translationsVisible
            || !snapshot.imageData
            || snapshot.regions.length === 0
        ) {
            logger.debug('Translator', 'Steam screenshot has no ready visible translation overlay to include');
            return;
        }
        if (this.steamScreenshotAnnotationInProgress) {
            logger.warn('Translator', 'Steam screenshot annotation already in progress, keeping native screenshot');
            return;
        }

        const appIdValue = Router.MainRunningApp?.appid;
        if (appIdValue === undefined || appIdValue === null || String(appIdValue).trim() === '') {
            logger.warn('Translator', 'Cannot annotate Steam screenshot without a running app ID');
            return;
        }

        this.steamScreenshotAnnotationInProgress = true;
        try {
            // Keep the app ID as a string: non-Steam shortcut IDs can exceed
            // JavaScript's safe integer range and must match Steam's directory exactly.
            const appId = String(appIdValue);
            logger.debug(
                'Translator',
                `Preparing Steam screenshot translation in ${this.steamScreenshotKeepOriginal ? 'copy' : 'replace'} mode`,
            );
            const response = await call<[string, number], SteamScreenshotResponse>(
                'wait_for_steam_screenshot',
                appId,
                Date.now(),
            );
            if (
                !response?.found
                || !response.capture_token
                || !response.mime
                || !response.base64
            ) {
                logger.warn('Translator', `Native Steam screenshot not available: ${response?.reason || 'unknown'}`);
                await this.notify(
                    'Screenshot kept without translations',
                    2500,
                    'Steam screenshot file was not found in time',
                );
                return;
            }

            const annotatedImage = await renderTranslatedSteamScreenshot(
                response.base64,
                response.mime,
                snapshot,
            );
            const result = await call<
                [string, string],
                {
                    success: boolean;
                    reason?: string;
                    thumbnail_updated?: boolean;
                    mode?: 'replace' | 'copy';
                }
            >(
                'replace_steam_screenshot',
                response.capture_token,
                annotatedImage,
            );
            if (!result?.success) {
                logger.warn('Translator', `Steam screenshot replacement failed: ${result?.reason || 'unknown'}`);
                await this.notify(
                    'Screenshot kept without translations',
                    2500,
                    'The original Steam screenshot was preserved',
                );
                return;
            }

            logger.info(
                'Translator',
                `Steam screenshot translation written; mode=${result.mode || 'replace'}, `
                    + `thumbnail_updated=${Boolean(result.thumbnail_updated)}`,
            );
            await this.notify(
                result.mode === 'copy'
                    ? 'Translated screenshot copy saved'
                    : 'Steam screenshot saved with translations',
                1800,
            );
        } catch (error) {
            logger.error('Translator', 'Could not annotate Steam screenshot; original remains intact', error);
            await this.notify(
                'Screenshot kept without translations',
                2500,
                'The original Steam screenshot was preserved',
            );
        } finally {
            this.steamScreenshotAnnotationInProgress = false;
        }
    }

    takeScreenshotAndTestOcr = async (): Promise<void> => {
        if (this.isProcessing || !this.enabled) {
            logger.debug('Translator', 'Already processing a screenshot or plugin disabled, skipping OCR test');
            return;
        }

        if (!this.canStartOcrTest()) return;

        if (this.imageState.isVisible()) {
            this.dismiss();
        }

        const runId = ++this.currentRunId;
        const isCancelled = (): boolean => runId !== this.currentRunId;

        try {
            this.isProcessing = true;

            const appName = Router.MainRunningApp?.display_name || "";
            logger.info('Translator', `Taking new screenshot for OCR test: ${appName}`);
            const result = await call<[string], ScreenshotResponse>('take_screenshot', appName);

            if (isCancelled()) {
                logger.debug('Translator', 'OCR test cancelled before screenshot processed');
                return;
            }

            if (!result || !result.path || !result.base64) {
                logger.warn('Translator', 'OCR test screenshot capture failed, not opening overlay');
                this.notify('Screen capture failed', 2500, 'Try the OCR test again');
                return;
            }

            this.imageState.startLoading("Testing OCR");
            this.imageState.showImage(result.base64);
            this.imageState.updateProcessingStep("Recognizing", false, this.ocrMethodHint());

            const textRegions = await this.textRecognizer.recognizeTextFile(result.path);
            if (isCancelled()) {
                logger.debug('Translator', 'OCR test cancelled after recognition');
                return;
            }
            logger.info('Translator', `OCR test found ${textRegions.length} text regions`);

            if (textRegions.length > 0) {
                const recognizedRegions = textRegions.map(region => ({
                    ...region,
                    translatedText: region.text,
                }));
                this.imageState.showTranslatedImage(result.base64, recognizedRegions);
            } else {
                this.imageState.updateProcessingStep("No text found");
                setTimeout(() => {
                    if (!isCancelled()) this.imageState.hideImage();
                }, 2000);
            }
        } catch (error) {
            if (isCancelled()) {
                logger.debug('Translator', 'OCR test cancelled, suppressing error UI', error);
                return;
            }

            logger.error('Translator', 'OCR test error', error);
            if (error instanceof NetworkError) {
                this.imageState.updateProcessingStep(error.message || "No internet connection", true);
            } else if (error instanceof ApiKeyError) {
                this.imageState.updateProcessingStep(error.message || "Invalid API key", true);
            } else if (error instanceof ModelNotAvailableError || error instanceof RateLimitError) {
                this.imageState.updateProcessingStep(error.message, true);
            } else {
                this.imageState.updateProcessingStep("OCR test failed", true);
            }
            setTimeout(() => {
                if (!isCancelled()) this.imageState.hideImage();
            }, 3000);
        } finally {
            if (!isCancelled()) {
                this.isProcessing = false;
            }
        }
    }

    setInputLanguage = (language: string): void => {
        if (language !== this.textTranslator.getInputLanguage()) {
            this.translationCache.clear();
        }
        this.textTranslator.setInputLanguage(language);
    }

    getInputLanguage = (): string => {
        return this.textTranslator.getInputLanguage();
    }

    setTargetLanguage = (language: string): void => {
        if (language !== this.textTranslator.getTargetLanguage()) {
            this.translationCache.clear();
        }
        this.textTranslator.setTargetLanguage(language);
    }

    getTargetLanguage = (): string => {
        return this.textTranslator.getTargetLanguage();
    }

    // Method to set input mode
    setInputMode = (mode: InputMode): void => {
        this.shortcutInput.setInputMode(mode);
    }

    // Method to get current input mode
    getInputMode = (): InputMode => {
        return this.shortcutInput.getInputMode();
    }

    // Method to set translation hold time
    setHoldTimeTranslate = (ms: number): void => {
        if (this.shortcutInput) {
            this.shortcutInput.setTranslateHoldTime(ms);
        }
    }

    // Method to get translation hold time
    getHoldTimeTranslate = (): number => {
        return this.shortcutInput ? this.shortcutInput.getTranslateHoldTime() : 1000;
    }

    // Method to set dismiss hold time
    setHoldTimeDismiss = (ms: number): void => {
        if (this.shortcutInput) {
            this.shortcutInput.setDismissHoldTime(ms);
        }
    }

    // Method to get dismiss hold time
    getHoldTimeDismiss = (): number => {
        return this.shortcutInput ? this.shortcutInput.getDismissHoldTime() : 500;
    }

    // Method to set quick toggle enabled
    setQuickToggleEnabled = (enabled: boolean): void => {
        if (this.shortcutInput) {
            this.shortcutInput.setQuickToggleEnabled(enabled);
        }
    }

    // Method to get quick toggle enabled state
    getQuickToggleEnabled = (): boolean => {
        return this.shortcutInput ? this.shortcutInput.getQuickToggleEnabled() : false;
    }

    setFontScale = (scale: number): void => {
        this.imageState.setFontScale(scale);
    }

    setTextBoxOpacity = (opacity: number): void => {
        this.imageState.setTextBoxOpacity(opacity);
    }

    setSteamScreenshotTranslationEnabled = (enabled: boolean): void => {
        this.steamScreenshotTranslationEnabled = enabled;
    }

    setSteamScreenshotKeepOriginal = (enabled: boolean): void => {
        this.steamScreenshotKeepOriginal = enabled;
    }

    setAllowLabelGrowth = (allow: boolean): void => {
        this.imageState.setAllowLabelGrowth(allow);
    }

    setTranslatedTextAlignment = (alignment: 'left' | 'right' | 'center' | 'justify'): void => {
        this.imageState.setTranslatedTextAlignment(alignment);
    }

    setTranslatedTextFontFamily = (fontFamily: string): void => {
        this.imageState.setTranslatedTextFontFamily(fontFamily);
    }

    setTranslatedTextFontStyle = (style: 'normal' | 'bold' | 'italic' | 'bolditalic'): void => {
        this.imageState.setTranslatedTextFontStyle(style);
    }

    // Methods for provider settings (used for upfront API key validation)
    setOcrProvider = (provider: string): void => {
        if (provider !== this.ocrProvider) {
            this.translationCache.clear();
        }
        this.ocrProvider = provider;
        logger.debug('Translator', `OCR provider set to: ${provider}`);
    }

    setLlmEndpointCacheKey = (cacheKey: string): void => {
        if (cacheKey !== this.llmEndpointCacheKey) {
            this.llmEndpointCacheKey = cacheKey;
            this.translationCache.clear();
            logger.debug('Translator', 'Translation cache cleared because the LLM endpoint changed');
        }
    }

    private translationMethodHint(): string {
        return t("Selected LLM endpoint");
    }

    private ocrMethodHint(): string {
        const labels: Record<string, string> = {
            rapidocr: "On-Device",
            chromescreenai: "On-Device",
            ocrspace: "OCR.space",
            googlecloud: "Google Cloud",
            legacy_gemini_vision: "Legacy Gemini Vision",
        };
        return t(labels[this.ocrProvider] || this.ocrProvider);
    }

    setHasGoogleApiKey = (hasKey: boolean): void => {
        this.hasGoogleApiKey = hasKey;
        logger.debug('Translator', `Google API key available: ${hasKey}`);
    }

    setHasGeminiApiKey = (hasKey: boolean): void => {
        this.hasGeminiApiKey = hasKey;
        logger.debug('Translator', `Gemini API key available: ${hasKey}`);
    }

    setHasSelectedLLMEndpoint = (hasEndpoint: boolean): void => {
        this.hasSelectedLLMEndpoint = hasEndpoint;
    }

    // Runs all pre-checks that would prevent a translation from starting.
    // Returns false and shows a toast if any check fails.
    private canStartTranslation(): boolean {
        const inputLang = this.getInputLanguage();
        const targetLang = this.getTargetLanguage();
        if (!inputLang && targetLang) {
            logger.warn('Translator', 'Cannot start translation: languages not configured');
            this.notify("Input language is not set", 3000, "Please select it in the plugin settings");
            return false;
        }
        if (!targetLang && inputLang) {
            logger.warn('Translator', 'Cannot start translation: languages not configured');
            this.notify("Output language is not set", 3000, "Please select it in the plugin settings");
            return false;
        }
        if (!inputLang && !targetLang) {
            logger.warn('Translator', 'Cannot start translation: languages not configured');
            this.notify("Output and Input languages are not set", 3000, "Please select them in the plugin settings");
            return false;
        }

        if (inputLang !== 'auto' && inputLang === targetLang) {
            logger.warn('Translator', `Cannot start translation: input and output language are both ${inputLang}`);
            this.notify("Input and output languages can not be the same", 3000, "Select change them in plugin settings");
            return false;
        }

        const apiKeyCheck = this.requiresApiKeyButMissing();
        if (apiKeyCheck.missing) {
            logger.warn('Translator', `Cannot start translation: ${apiKeyCheck.message}`);
            this.notify(apiKeyCheck.message, 3000, "Please configure your API key in the Translation settings tab.");
            return false;
        }

        return true;
    }

    private canStartOcrTest(): boolean {
        if (this.ocrProvider === 'legacy_gemini_vision') {
            this.notify(
                "OCR-only test unavailable",
                3000,
                "Legacy Gemini Vision combines recognition and translation in one request.",
            );
            return false;
        }

        if (!this.getInputLanguage()) {
            this.notify(
                "Input language is not set",
                3000,
                "Select an input language before testing OCR.",
            );
            return false;
        }

        if (this.ocrProvider === 'googlecloud' && !this.hasGoogleApiKey) {
            this.notify(
                "API key required for OCR",
                3000,
                "Configure the Google Cloud OCR API key before testing.",
            );
            return false;
        }

        return true;
    }

    // Check if the current provider configuration requires an API key that's missing
    private requiresApiKeyButMissing(): { missing: boolean; message: string } {
        if (this.ocrProvider === 'legacy_gemini_vision' && !this.hasGeminiApiKey) {
            return { missing: true, message: "Gemini API key required for Legacy Gemini Vision" };
        }

        const ocrNeedsKey = this.ocrProvider === 'googlecloud';
        if (ocrNeedsKey && !this.hasGoogleApiKey) {
            return { missing: true, message: "API key required for OCR" };
        }
        if (this.ocrProvider !== 'legacy_gemini_vision' && !this.hasSelectedLLMEndpoint) {
            return { missing: true, message: "Select an LLM endpoint" };
        }
        return { missing: false, message: "" };
    }
}
