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
import { HiInboxArrowDown, HiKey, HiMagnifyingGlass, HiPencil, HiPlus, HiTrash } from 'react-icons/hi2';

import { ApiKeyTransferHint } from '../ApiKeyTransferHint';
import { LLMEndpointSection } from '../LLMEndpoints';
import { logger } from '../Logger';
import { CustomLanguage, useSettings } from '../SettingsContext';
import { GameTranslatorLogic } from '../Translator';
import { t } from '../i18n';

const languageOptions = [
    { label: '🌐 Auto-detect', data: 'auto' },
    { label: '🇸🇦 Arabic', data: 'ar' },
    { label: '🇧🇬 Bulgarian', data: 'bg' },
    { label: '🇨🇳 Chinese (Simplified)', data: 'zh-CN' },
    { label: '🇨🇳 Chinese (Traditional)', data: 'zh-TW' },
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
const builtInOutputLanguageOptions = languageOptions.filter((item) => item.data !== 'auto');
const builtInOutputLanguageValues = new Set(builtInOutputLanguageOptions.map((item) => item.data));
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
                    label={t("API Key")}
                    value={key}
                    bIsPassword
                    bShowClearAction
                    onChange={(event) => setKey(event.target.value)}
                />
                <ApiKeyTransferHint />
                <Focusable style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
                    <DialogButton onClick={closeModal}>{t("Cancel")}</DialogButton>
                    <DialogButton onClick={() => { onSave(key.trim()); closeModal?.(); }} disabled={!key.trim()}>
                        {t("Save")}
                    </DialogButton>
                </Focusable>
            </div>
        </ModalRoot>
    );
};

const CustomLanguagesModal: VFC<{
    languages: CustomLanguage[];
    selectedDefinition: string;
    onSave: (languages: CustomLanguage[], nextTargetLanguage: string) => Promise<boolean>;
    closeModal?: () => void;
}> = ({ languages, selectedDefinition, onSave, closeModal }) => {
    const [draftLanguages, setDraftLanguages] = useState<CustomLanguage[]>(languages);
    const [nextTargetLanguage, setNextTargetLanguage] = useState(selectedDefinition);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [alias, setAlias] = useState('');
    const [definition, setDefinition] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const startAdding = () => {
        setEditingIndex(draftLanguages.length);
        setAlias('');
        setDefinition('');
        setError('');
    };

    const startEditing = (index: number) => {
        setEditingIndex(index);
        setAlias(draftLanguages[index].alias);
        setDefinition(draftLanguages[index].definition);
        setError('');
    };

    const cancelEditing = () => {
        setEditingIndex(null);
        setAlias('');
        setDefinition('');
        setError('');
    };

    const applyEditor = () => {
        if (editingIndex === null) return;
        const trimmedAlias = alias.trim();
        const trimmedDefinition = definition.trim();
        if (!trimmedAlias || !trimmedDefinition) {
            setError(t('Alias and definition are required.'));
            return;
        }
        if (trimmedAlias.length > 80) {
            setError(t('Alias must be 80 characters or fewer.'));
            return;
        }
        if (trimmedDefinition.length > 2000) {
            setError(t('Definition must be 2000 characters or fewer.'));
            return;
        }
        if (builtInOutputLanguageValues.has(trimmedDefinition)) {
            setError(t('This definition is already used by a built-in output language.'));
            return;
        }
        if (draftLanguages.some((item, index) => index !== editingIndex
            && item.alias.toLocaleLowerCase() === trimmedAlias.toLocaleLowerCase())) {
            setError(t('Each custom language needs a unique alias.'));
            return;
        }
        if (draftLanguages.some((item, index) => index !== editingIndex
            && item.definition === trimmedDefinition)) {
            setError(t('Each custom language needs a unique definition.'));
            return;
        }

        const next = [...draftLanguages];
        const previous = next[editingIndex];
        next[editingIndex] = { alias: trimmedAlias, definition: trimmedDefinition };
        setDraftLanguages(next);
        if (previous?.definition === nextTargetLanguage) setNextTargetLanguage(trimmedDefinition);
        cancelEditing();
    };

    const deleteLanguage = (index: number) => {
        const deleted = draftLanguages[index];
        setDraftLanguages(draftLanguages.filter((_, itemIndex) => itemIndex !== index));
        if (deleted.definition === nextTargetLanguage) setNextTargetLanguage('');
        if (editingIndex === index) cancelEditing();
        else if (editingIndex !== null && editingIndex > index) setEditingIndex(editingIndex - 1);
    };

    const save = async () => {
        if (saving || editingIndex !== null) return;
        setSaving(true);
        setError('');
        try {
            if (await onSave(draftLanguages, nextTargetLanguage)) closeModal?.();
            else setError(t('Could not save custom languages.'));
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : t('Could not save custom languages.'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalRoot onCancel={closeModal} onEscKeypress={closeModal}>
            <div style={{ padding: '20px', minWidth: '460px', maxWidth: '620px' }}>
                <h2>{t("Custom Output Languages")}</h2>
                <p style={{ color: '#aaa', fontSize: '13px', lineHeight: 1.45 }}>
                    {t("The alias appears in the output-language list. The definition is sent to the LLM as the target language.")}
                </p>

                <div style={{ maxHeight: '280px', overflowY: 'auto', margin: '14px 0' }}>
                    {!draftLanguages.length && (
                        <div style={{ color: '#888', fontSize: '13px', padding: '12px 0' }}>
                            {t("No custom output languages yet.")}
                        </div>
                    )}
                    {draftLanguages.map((language, index) => (
                        <Focusable
                            key={`${language.alias}-${index}`}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(0, 1fr) 44px 44px',
                                gap: '8px',
                                alignItems: 'center',
                                padding: '8px 0',
                                borderBottom: '1px solid rgba(255,255,255,0.12)',
                            }}
                        >
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {language.alias}
                                </div>
                                <div
                                    title={language.definition}
                                    style={{
                                        color: '#aaa',
                                        fontSize: '12px',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {language.definition}
                                </div>
                            </div>
                            <DialogButton
                                onClick={() => startEditing(index)}
                                aria-label={t('Edit {name}', { name: language.alias })}
                                style={{
                                    width: '44px',
                                    height: '36px',
                                    minWidth: '44px',
                                    padding: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <HiPencil size={18} />
                            </DialogButton>
                            <DialogButton
                                onClick={() => deleteLanguage(index)}
                                aria-label={t('Delete {name}', { name: language.alias })}
                                style={{
                                    width: '44px',
                                    height: '36px',
                                    minWidth: '44px',
                                    padding: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#ff8a80',
                                }}
                            >
                                <HiTrash size={18} />
                            </DialogButton>
                        </Focusable>
                    ))}
                </div>

                {editingIndex === null ? (
                    <DialogButton onClick={startAdding} disabled={draftLanguages.length >= 50}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <HiPlus /> {t("Add Language")}
                        </span>
                    </DialogButton>
                ) : (
                    <div style={{ padding: '12px', background: 'rgba(0,0,0,0.18)', borderRadius: '4px' }}>
                        <h3 style={{ marginTop: 0 }}>{editingIndex < draftLanguages.length ? t('Edit Language') : t('Add Language')}</h3>
                        <TextField
                            label={t("Alias")}
                            description={t("Short name shown in the output-language list")}
                            value={alias}
                            onChange={(event) => setAlias(event.target.value)}
                        />
                        <TextField
                            label={t("Definition")}
                            description={t("Exact target-language instruction sent to the LLM")}
                            value={definition}
                            onChange={(event) => setDefinition(event.target.value.slice(0, 2000))}
                        />
                        <Focusable style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                            <DialogButton onClick={cancelEditing}>{t("Cancel")}</DialogButton>
                            <DialogButton onClick={applyEditor} disabled={!alias.trim() || !definition.trim()}>
                                {t("Apply")}
                            </DialogButton>
                        </Focusable>
                    </div>
                )}

                {error && <div style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '10px' }}>{error}</div>}
                <Focusable style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
                    <DialogButton onClick={closeModal}>{t("Cancel")}</DialogButton>
                    <DialogButton onClick={save} disabled={saving || editingIndex !== null}>
                        {saving ? t('Saving…') : t('Save')}
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
                {status.downloading ? t('Installing… {progress}%', { progress: Math.round((status.progress || 0) * 100) })
                    : status.downloaded ? t('OCR model installed') : t('OCR model download required')}
            </div>
            {status.error && <div style={{ color: '#ff6b6b', fontSize: '11px' }}>{t(status.error)}</div>}
            <Focusable style={{ display: 'flex', gap: '8px' }}>
                {!status.downloaded && (
                    <DialogButton onClick={async () => { await call(downloadMethod); await refresh(); }} disabled={status.downloading}>
                        <HiInboxArrowDown /> {t("Install")}
                    </DialogButton>
                )}
                {status.downloaded && (
                    <DialogButton onClick={async () => { await call(deleteMethod); await refresh(); }}>
                        <HiTrash /> {t("Delete")}
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
    const { settings, updateSetting, updateLanguageSettings } = useSettings();
    const chromeActionRef = useRef<HTMLDivElement>(null);
    const rapidActionRef = useRef<HTMLDivElement>(null);
    const legacyMode = settings.ocrProvider === 'legacy_gemini_vision';
    const localizeLanguageOption = (item: { label: string; data: string }) => {
        const separator = item.label.indexOf(' ');
        if (separator < 0) return { ...item, label: t(item.label) };
        const prefix = item.label.slice(0, separator + 1);
        return { ...item, label: `${prefix}${t(item.label.slice(separator + 1))}` };
    };
    const outputLanguageOptions = [
        { ...selectLanguageOption, label: t(selectLanguageOption.label) },
        ...builtInOutputLanguageOptions.map(localizeLanguageOption),
        ...settings.customLanguages.map((language) => ({
            label: language.alias,
            data: language.definition,
        })),
    ];

    const inputOptions = [
        { ...selectLanguageOption, label: t(selectLanguageOption.label) },
        ...(settings.ocrProvider === 'rapidocr'
            ? languageOptions.filter((item) => item.data === 'auto' || rapidocrLanguages.has(item.data)).map(localizeLanguageOption)
            : languageOptions.map(localizeLanguageOption)),
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
            title={t("Google Cloud OCR API Key")}
            description={t("Used only for Google Cloud Vision OCR. The key is write-only after saving.")}
            onSave={(key) => updateSetting('googleApiKey', key, 'Google OCR API key')}
        />
    );
    const openLegacyGeminiKey = () => showModal(
        <ApiKeyModal
            title={t("Legacy Gemini Vision API Key")}
            description={t("Used only by the retained combined OCR + translation mode. The key is write-only after saving.")}
            onSave={(key) => updateSetting('geminiApiKey', key, 'Legacy Gemini API key')}
        />
    );
    const openCustomLanguages = () => showModal(
        <CustomLanguagesModal
            languages={settings.customLanguages}
            selectedDefinition={settings.targetLanguage}
            onSave={updateLanguageSettings}
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
            <PanelSection title={t("Languages")}>
                <PanelSectionRow>
                    <DropdownItem
                        layout="below"
                        label={t("Input Language")}
                        description={t("Source language for OCR; use auto-detect if unsure")}
                        rgOptions={inputOptions}
                        selectedOption={settings.inputLanguage}
                        onChange={(option: any) => updateSetting('inputLanguage', option.data, 'Input language')}
                    />
                </PanelSectionRow>
                <PanelSectionRow>
                    <DropdownItem
                        layout="below"
                        label={t("Output Language")}
                        description={t("Target language for LLM translation")}
                        rgOptions={outputLanguageOptions}
                        selectedOption={settings.targetLanguage}
                        onChange={(option: any) => updateSetting('targetLanguage', option.data, 'Output language')}
                    />
                </PanelSectionRow>
                <PanelSectionRow>
                    <ButtonItem
                        layout="below"
                        label={t("Custom Languages")}
                        description={t("Add output styles and languages that are not in the built-in list")}
                        onClick={openCustomLanguages}
                    >
                        {t("Manage Custom Languages")}
                    </ButtonItem>
                </PanelSectionRow>
            </PanelSection>

            <PanelSection title={t("Recognition")}>
                <PanelSectionRow>
                    <Field label={t("Text Recognition Method")} childrenContainerWidth="max" childrenLayout="below">
                        <Focusable style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <div style={{ flex: 1 }}>
                                <Dropdown
                                    rgOptions={[
                                        { label: t('On-Device (Chrome)'), data: 'chromescreenai' },
                                        { label: t('On-Device (RapidOCR)'), data: 'rapidocr' },
                                        { label: 'OCR.space', data: 'ocrspace' },
                                        { label: 'Google Cloud Vision', data: 'googlecloud' },
                                        { label: <span>{t('Legacy Gemini Vision (Combined)')} <BsStars /></span>, data: 'legacy_gemini_vision' },
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
                            label={t("Legacy Gemini Model")}
                            description={t("This mode lets Gemini detect boxes and translate in one request")}
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
                            label={t("Faster Recognition")}
                            description={t("Keep Chrome Screen AI loaded between translations")}
                            checked={settings.chromeScreenAiPersistentMode}
                            onChange={(value) => updateSetting('chromeScreenAiPersistentMode', value, 'Faster recognition')}
                        />
                    </PanelSectionRow>
                )}
                {settings.ocrProvider === 'rapidocr' && (
                    <PanelSectionRow>
                        <ToggleField
                            label={t("Faster Recognition")}
                            description={t("Keep RapidOCR loaded between translations")}
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
                                label={t("OCR Confidence")}
                                value={settings.rapidocrConfidence}
                                showValue
                                onChange={(value) => updateSetting('rapidocrConfidence', value, 'RapidOCR confidence')}
                            />
                        </PanelSectionRow>
                        <PanelSectionRow>
                            <SliderField
                                min={0.1} max={0.95} step={0.05}
                                label={t("Box Detection Threshold")}
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
                        label={t("OCR Test")}
                        description={legacyMode
                            ? t("Unavailable because Legacy Gemini Vision combines recognition and translation")
                            : t("Capture the current game and show recognized text without calling the translation endpoint")}
                        disabled={!settings.enabled || legacyMode}
                        onClick={runOcrTest}
                    >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                            <HiMagnifyingGlass /> {t("Test OCR")}
                        </span>
                    </ButtonItem>
                </PanelSectionRow>
            </PanelSection>

            <LLMEndpointSection legacyMode={legacyMode} />
        </div>
    );
};
