import {
    ButtonItem,
    DialogButton,
    Dropdown,
    DropdownItem,
    Field,
    Focusable,
    ModalRoot,
    PanelSection,
    PanelSectionRow,
    Router,
    SliderField,
    TextField,
    ToggleField,
    showModal,
} from '@decky/ui';
import { call } from '@decky/api';
import { VFC, useCallback, useEffect, useRef, useState } from 'react';
import { BsStars } from 'react-icons/bs';
import { HiInboxArrowDown, HiKey, HiMagnifyingGlass, HiTrash } from 'react-icons/hi2';

import { ApiKeyTransferHint } from '../ApiKeyTransferHint';
import { LLMEndpointSection } from '../LLMEndpoints';
import { logger } from '../Logger';
import { useSettings } from '../SettingsContext';
import { GameTranslatorLogic } from '../Translator';

const languageOptions = [
    { label: '🌐 Auto-detect', data: 'auto' },
    { label: '🇸🇦 Arabic', data: 'ar' },
    { label: '🇧🇬 Bulgarian', data: 'bg' },
    { label: '🇨🇳 Chinese (Simplified)', data: 'zh-CN' },
    { label: '🇹🇼 Chinese (Traditional)', data: 'zh-TW' },
    { label: '🇭🇷 Croatian', data: 'hr' },
    { label: '🇨🇿 Czech', data: 'cs' },
    { label: '🇩🇰 Danish', data: 'da' },
    { label: '🇳🇱 Dutch', data: 'nl' },
    { label: '🇬🇧 English', data: 'en' },
    { label: '🇫🇮 Finnish', data: 'fi' },
    { label: '🇫🇷 French', data: 'fr' },
    { label: '🇩🇪 German', data: 'de' },
    { label: '🇬🇷 Greek', data: 'el' },
    { label: '🇮🇳 Hindi', data: 'hi' },
    { label: '🇭🇺 Hungarian', data: 'hu' },
    { label: '🇮🇹 Italian', data: 'it' },
    { label: '🇯🇵 Japanese', data: 'ja' },
    { label: '🇰🇷 Korean', data: 'ko' },
    { label: '🇳🇴 Norwegian', data: 'no' },
    { label: '🇵🇱 Polish', data: 'pl' },
    { label: '🇵🇹 Portuguese', data: 'pt' },
    { label: '🇷🇴 Romanian', data: 'ro' },
    { label: '🇷🇺 Russian', data: 'ru' },
    { label: '🇪🇸 Spanish', data: 'es' },
    { label: '🇸🇪 Swedish', data: 'sv' },
    { label: '🇹🇭 Thai', data: 'th' },
    { label: '🇹🇷 Turkish', data: 'tr' },
    { label: '🇺🇦 Ukrainian', data: 'uk' },
    { label: '🇻🇳 Vietnamese', data: 'vi' },
];

const selectLanguageOption = { label: 'Select language…', data: '' };
const outputLanguageOptions = [
    selectLanguageOption,
    ...languageOptions.filter((item) => item.data !== 'auto'),
];
const rapidocrLanguages = new Set([
    'en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'pt', 'nl',
    'no', 'pl', 'tr', 'ro', 'vi', 'fi', 'hr', 'cs', 'hu', 'sv', 'da', 'ru',
    'uk', 'el', 'th', 'bg',
]);

const geminiModels = [
    { label: 'Gemini 2.5 Flash', data: 'gemini-2.5-flash' },
    { label: 'Gemini 2.5 Flash Lite', data: 'gemini-2.5-flash-lite' },
    { label: 'Gemini 3 Flash', data: 'gemini-3-flash' },
];

const ApiKeyModal: VFC<{
    title: string;
    description: string;
    onSave: (key: string) => void;
    closeModal?: () => void;
}> = ({ title, description, onSave, closeModal }) => {
    const [key, setKey] = useState('');
    return (
        <ModalRoot onCancel={closeModal} onEscKeypress={closeModal}>
            <div style={{ padding: '20px', minWidth: '420px' }}>
                <h2>{title}</h2>
                <p style={{ color: '#aaa', fontSize: '13px' }}>{description}</p>
                <TextField
                    label="API Key"
                    value={key}
                    bIsPassword
                    bShowClearAction
                    onChange={(event) => setKey(event.target.value)}
                />
                <ApiKeyTransferHint />
                <Focusable style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
                    <DialogButton onClick={closeModal}>Cancel</DialogButton>
                    <DialogButton onClick={() => { onSave(key.trim()); closeModal?.(); }} disabled={!key.trim()}>
                        Save
                    </DialogButton>
                </Focusable>
            </div>
        </ModalRoot>
    );
};

interface ModelStatus {
    downloaded: boolean;
    downloading: boolean;
    progress: number;
    error?: string | null;
}

const OcrModelAction: VFC<{
    statusMethod: string;
    downloadMethod: string;
    deleteMethod: string;
    actionRef: React.RefObject<HTMLDivElement>;
}> = ({ statusMethod, downloadMethod, deleteMethod, actionRef }) => {
    const [status, setStatus] = useState<ModelStatus>({ downloaded: false, downloading: false, progress: 0 });
    const refresh = useCallback(async () => {
        const result = await call<[], ModelStatus>(statusMethod);
        if (result) setStatus(result);
    }, [statusMethod]);

    useEffect(() => {
        refresh();
        const timer = setInterval(refresh, status.downloading ? 750 : 5000);
        return () => clearInterval(timer);
    }, [refresh, status.downloading]);

    return (
        <div ref={actionRef} tabIndex={-1} style={{ width: '100%', marginTop: '8px' }}>
            <div style={{ color: status.downloaded ? '#81c784' : '#ffb74d', fontSize: '12px', marginBottom: '6px' }}>
                {status.downloading ? `Installing… ${Math.round((status.progress || 0) * 100)}%`
                    : status.downloaded ? 'OCR model installed' : 'OCR model download required'}
            </div>
            {status.error && <div style={{ color: '#ff6b6b', fontSize: '11px' }}>{status.error}</div>}
            <Focusable style={{ display: 'flex', gap: '8px' }}>
                {!status.downloaded && (
                    <DialogButton onClick={async () => { await call(downloadMethod); await refresh(); }} disabled={status.downloading}>
                        <HiInboxArrowDown /> Install
                    </DialogButton>
                )}
                {status.downloaded && (
                    <DialogButton onClick={async () => { await call(deleteMethod); await refresh(); }}>
                        <HiTrash /> Delete
                    </DialogButton>
                )}
            </Focusable>
        </div>
    );
};

interface TabTranslationProps {
    logic: GameTranslatorLogic;
    scrollTarget?: string | null;
    onScrolled?: () => void;
}

export const TabTranslation: VFC<TabTranslationProps> = ({ logic, scrollTarget, onScrolled }) => {
    const { settings, updateSetting } = useSettings();
    const chromeActionRef = useRef<HTMLDivElement>(null);
    const rapidActionRef = useRef<HTMLDivElement>(null);
    const legacyMode = settings.ocrProvider === 'legacy_gemini_vision';

    const inputOptions = [
        selectLanguageOption,
        ...(settings.ocrProvider === 'rapidocr'
            ? languageOptions.filter((item) => item.data === 'auto' || rapidocrLanguages.has(item.data))
            : languageOptions),
    ];

    useEffect(() => {
        if (settings.ocrProvider === 'rapidocr'
            && settings.inputLanguage !== 'auto'
            && !rapidocrLanguages.has(settings.inputLanguage)) {
            updateSetting('inputLanguage', 'auto', 'Input language');
        }
    }, [settings.ocrProvider, settings.inputLanguage]);

    useEffect(() => {
        if (!scrollTarget) return;
        const target = scrollTarget === 'rapidocr-action' ? rapidActionRef.current : chromeActionRef.current;
        const timer = setTimeout(() => {
            target?.focus({ preventScroll: true });
            target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            onScrolled?.();
        }, 400);
        return () => clearTimeout(timer);
    }, [scrollTarget, onScrolled]);

    const openGoogleKey = () => showModal(
        <ApiKeyModal
            title="Google Cloud OCR API Key"
            description="Used only for Google Cloud Vision OCR. The key is write-only after saving."
            onSave={(key) => updateSetting('googleApiKey', key, 'Google OCR API key')}
        />
    );
    const openLegacyGeminiKey = () => showModal(
        <ApiKeyModal
            title="Legacy Gemini Vision API Key"
            description="Used only by the retained combined OCR + translation mode. The key is write-only after saving."
            onSave={(key) => updateSetting('geminiApiKey', key, 'Legacy Gemini API key')}
        />
    );

    const runOcrTest = () => {
        Router.CloseSideMenus();
        setTimeout(() => {
            logic.takeScreenshotAndTestOcr().catch(error => {
                logger.error('TabTranslation', 'OCR test failed', error);
            });
        }, 200);
    };

    return (
        <div style={{ paddingBottom: '40px' }}>
            <PanelSection title="Languages">
                <PanelSectionRow>
                    <DropdownItem
                        layout="below"
                        label="Input Language"
                        description="Source language for OCR; use auto-detect if unsure"
                        rgOptions={inputOptions}
                        selectedOption={settings.inputLanguage}
                        onChange={(option: any) => updateSetting('inputLanguage', option.data, 'Input language')}
                    />
                </PanelSectionRow>
                <PanelSectionRow>
                    <DropdownItem
                        layout="below"
                        label="Output Language"
                        description="Target language for LLM translation"
                        rgOptions={outputLanguageOptions}
                        selectedOption={settings.targetLanguage}
                        onChange={(option: any) => updateSetting('targetLanguage', option.data, 'Output language')}
                    />
                </PanelSectionRow>
            </PanelSection>

            <PanelSection title="Recognition">
                <PanelSectionRow>
                    <Field label="Text Recognition Method" childrenContainerWidth="max" childrenLayout="below">
                        <Focusable style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <div style={{ flex: 1 }}>
                                <Dropdown
                                    rgOptions={[
                                        { label: 'On-Device (Chrome)', data: 'chromescreenai' },
                                        { label: 'On-Device (RapidOCR)', data: 'rapidocr' },
                                        { label: 'OCR.space', data: 'ocrspace' },
                                        { label: 'Google Cloud Vision', data: 'googlecloud' },
                                        { label: <span>Legacy Gemini Vision (Combined) <BsStars /></span>, data: 'legacy_gemini_vision' },
                                    ]}
                                    selectedOption={settings.ocrProvider}
                                    onChange={(option: any) => updateSetting('ocrProvider', option.data, 'OCR provider')}
                                />
                            </div>
                            {settings.ocrProvider === 'googlecloud' && (
                                <DialogButton onClick={openGoogleKey} style={{ minWidth: '44px' }}>
                                    <HiKey color={settings.googleApiKey ? '#81c784' : '#ff6b6b'} />
                                </DialogButton>
                            )}
                            {legacyMode && (
                                <DialogButton onClick={openLegacyGeminiKey} style={{ minWidth: '44px' }}>
                                    <HiKey color={settings.geminiApiKey ? '#81c784' : '#ff6b6b'} />
                                </DialogButton>
                            )}
                        </Focusable>
                    </Field>
                </PanelSectionRow>

                {legacyMode && (
                    <PanelSectionRow>
                        <DropdownItem
                            layout="below"
                            label="Legacy Gemini Model"
                            description="This mode lets Gemini detect boxes and translate in one request"
                            rgOptions={geminiModels}
                            selectedOption={settings.geminiModel}
                            onChange={(option: any) => updateSetting('geminiModel', option.data, 'Legacy Gemini model')}
                        />
                    </PanelSectionRow>
                )}

                {settings.ocrProvider === 'chromescreenai' && (
                    <PanelSectionRow>
                        <OcrModelAction
                            statusMethod="get_chromescreenai_status"
                            downloadMethod="download_chromescreenai"
                            deleteMethod="delete_chromescreenai"
                            actionRef={chromeActionRef}
                        />
                    </PanelSectionRow>
                )}
                {settings.ocrProvider === 'rapidocr' && (
                    <PanelSectionRow>
                        <OcrModelAction
                            statusMethod="get_rapidocr_models_status"
                            downloadMethod="download_rapidocr_models"
                            deleteMethod="delete_rapidocr_models"
                            actionRef={rapidActionRef}
                        />
                    </PanelSectionRow>
                )}

                {settings.ocrProvider === 'chromescreenai' && (
                    <PanelSectionRow>
                        <ToggleField
                            label="Faster Recognition"
                            description="Keep Chrome Screen AI loaded between translations"
                            checked={settings.chromeScreenAiPersistentMode}
                            onChange={(value) => updateSetting('chromeScreenAiPersistentMode', value, 'Faster recognition')}
                        />
                    </PanelSectionRow>
                )}
                {settings.ocrProvider === 'rapidocr' && (
                    <PanelSectionRow>
                        <ToggleField
                            label="Faster Recognition"
                            description="Keep RapidOCR loaded between translations"
                            checked={settings.rapidocrPersistentMode}
                            onChange={(value) => updateSetting('rapidocrPersistentMode', value, 'Faster recognition')}
                        />
                    </PanelSectionRow>
                )}

                {settings.ocrProvider === 'rapidocr' && (
                    <>
                        <PanelSectionRow>
                            <SliderField
                                min={0.1} max={0.95} step={0.05}
                                label="OCR Confidence"
                                value={settings.rapidocrConfidence}
                                showValue
                                onChange={(value) => updateSetting('rapidocrConfidence', value, 'RapidOCR confidence')}
                            />
                        </PanelSectionRow>
                        <PanelSectionRow>
                            <SliderField
                                min={0.1} max={0.95} step={0.05}
                                label="Box Detection Threshold"
                                value={settings.rapidocrBoxThresh}
                                showValue
                                onChange={(value) => updateSetting('rapidocrBoxThresh', value, 'RapidOCR box threshold')}
                            />
                        </PanelSectionRow>
                    </>
                )}

                <PanelSectionRow>
                    <ButtonItem
                        layout="below"
                        label="OCR Test"
                        description={legacyMode
                            ? "Unavailable because Legacy Gemini Vision combines recognition and translation"
                            : "Capture the current game and show recognized text without calling the translation endpoint"}
                        disabled={!settings.enabled || legacyMode}
                        onClick={runOcrTest}
                    >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                            <HiMagnifyingGlass /> Test OCR
                        </span>
                    </ButtonItem>
                </PanelSectionRow>
            </PanelSection>

            <LLMEndpointSection legacyMode={legacyMode} />
        </div>
    );
};
