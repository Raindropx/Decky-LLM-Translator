// src/tabs/TabMain.tsx - Main tab with enable toggle and translate button

import {
    ButtonItem,
    PanelSection,
    PanelSectionRow,
    ToggleField,
    Router
} from "@decky/ui";

import { VFC } from "react";
import { BsTranslate, BsXLg, BsEye, BsStars } from "react-icons/bs";
import { HiInboxArrowDown, HiMagnifyingGlass } from "react-icons/hi2";
import { useSettings } from "../SettingsContext";
import { GameTranslatorLogic } from "../Translator";
import { logger } from "../Logger";
import { t } from "../i18n";

const StatusDot: VFC<{ ok: boolean }> = ({ ok }) => (
    <span style={{
        display: 'inline-block',
        width: '5px',
        height: '5px',
        borderRadius: '50%',
        backgroundColor: ok ? '#4caf50' : '#ff6b6b',
        marginRight: '6px',
        flexShrink: 0
    }} />
);

const PendingDot: VFC = () => (
    <span style={{
        display: 'inline-block',
        width: '5px',
        height: '5px',
        borderRadius: '50%',
        backgroundColor: '#888',
        marginRight: '6px',
        flexShrink: 0
    }} />
);

const InstallingDot: VFC = () => (
    <span style={{
        display: 'inline-block',
        width: '5px',
        height: '5px',
        borderRadius: '50%',
        backgroundColor: '#ffa726',
        marginRight: '6px',
        flexShrink: 0
    }} />
);

type ReachResult = { ok: boolean; reason: string; provider: string } | null | undefined;

const ReachabilityRow: VFC<{ result: ReachResult; expectedProvider: string }> = ({ result, expectedProvider }) => {
    if (!result || result.provider !== expectedProvider) {
        return (
            <div style={{ color: '#666', fontSize: '10px', display: 'flex', alignItems: 'center' }}>
                <PendingDot />
                <span>{t("Checking...")}</span>
            </div>
        );
    }
    return (
        <div style={{ color: '#666', fontSize: '10px', display: 'flex', alignItems: 'center' }}>
            <StatusDot ok={result.ok} />
            <span>{result.ok ? t('Ready') : t('Not ready ({reason})', { reason: t(result.reason || 'unreachable') })}</span>
        </div>
    );
};

interface TabMainProps {
    logic: GameTranslatorLogic;
    overlayVisible: boolean;
    providerStatus: any;
    webReachability: {
        ocr?: ReachResult;
        translation?: ReachResult;
    } | null;
    onNavigateToTab: (tabId: string, scrollTargetId?: string) => void;
}

export const TabMain: VFC<TabMainProps> = ({ logic, overlayVisible, providerStatus, webReachability, onNavigateToTab }) => {
    const { settings, updateSetting } = useSettings();

    const ocrNeedsDownload =
        !!providerStatus
        && ((settings.ocrProvider === 'chromescreenai' && !providerStatus.chromescreenai_downloaded)
            || (settings.ocrProvider === 'rapidocr' && !providerStatus.rapidocr_downloaded));

    const selectedEndpoint = settings.llmEndpoints.find(
        (endpoint) => endpoint.id === settings.selectedLlmEndpointId
    );

    const handleButtonClick = () => {
        if (overlayVisible) {
            logic.dismiss();
            Router.CloseSideMenus();
            return;
        }
        if (ocrNeedsDownload) {
            const target = settings.ocrProvider === 'rapidocr' ? 'rapidocr-action' : 'chromescreenai-action';
            onNavigateToTab('translation', target);
            return;
        }
        // Close menu first, then wait for UI to fully close before taking screenshot
        Router.CloseSideMenus();
        setTimeout(() => {
            logic.takeScreenshotAndTranslate().catch(err => logger.error('TabMain', 'Screenshot failed', err));
        }, 200);
    };

    const handleOcrTestClick = () => {
        Router.CloseSideMenus();
        setTimeout(() => {
            logic.takeScreenshotAndTestOcr().catch(err => logger.error('TabMain', 'OCR test failed', err));
        }, 200);
    };

    const renderButtonContent = () => {
        if (overlayVisible) {
            return <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}><BsXLg /> {t("Close Overlay")}</span>;
        }
        if (ocrNeedsDownload) {
            return <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}><HiInboxArrowDown size={20} /> {t("Download required")}</span>;
        }
        return <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}><BsTranslate /> {t("Translate")}</span>;
    };

    return (
        <div>
            <PanelSection>
                <PanelSectionRow>
                    <ToggleField
                        label={settings.enabled ? t("Plugin is enabled") : t("Plugin is disabled")}
                        description={t("Toggle the functionality on or off")}
                        checked={settings.enabled}
                        onChange={(value) => updateSetting('enabled', value, 'Decky LLM Translator')}
                    />
                </PanelSectionRow>

                {settings.enabled && (
                    <>
                        <PanelSectionRow>
                            <ButtonItem
                                bottomSeparator="standard"
                                layout="below"
                                onClick={handleButtonClick}>
                                {renderButtonContent()}
                            </ButtonItem>
                        </PanelSectionRow>

                        {overlayVisible && (
                            <PanelSectionRow>
                                <ButtonItem
                                    bottomSeparator="standard"
                                    layout="below"
                                    disabled={!selectedEndpoint?.enabled || !logic.canAskAI()}
                                    onClick={() => logic.openAskAI()}
                                >
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                                        <BsStars /> {t("Ask AI")}
                                    </span>
                                </ButtonItem>
                            </PanelSectionRow>
                        )}

                        <PanelSectionRow>
                            <ButtonItem
                                bottomSeparator="standard"
                                layout="below"
                                disabled={settings.ocrProvider === 'legacy_gemini_vision'}
                                onClick={handleOcrTestClick}
                            >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                                    <HiMagnifyingGlass /> {t("Test OCR")}
                                </span>
                            </ButtonItem>
                        </PanelSectionRow>

                        {/* Provider Status */}
                        <PanelSectionRow>
                            <div style={{ fontSize: '12px', marginTop: '8px' }}>
                                {settings.ocrProvider === 'legacy_gemini_vision' && (
                                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                                        <BsStars style={{ marginRight: '8px', color: '#aaa' }} />
                                        <span style={{ color: '#888' }}>{t("Recognize + Translate:")}</span>
                                        <span style={{ marginLeft: '6px', fontWeight: 'bold' }}>{t("Legacy Gemini Vision")}</span>
                                    </div>
                                )}
                                {settings.ocrProvider !== 'legacy_gemini_vision' && (
                                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                                        <BsEye style={{ marginRight: '8px', color: '#aaa' }} />
                                        <span style={{ color: '#888' }}>{t("Text Recognition:")}</span>
                                        <span style={{ marginLeft: '6px', fontWeight: 'bold' }}>
                                            {settings.ocrProvider === 'chromescreenai' ? t('On-Device') :
                                             settings.ocrProvider === 'rapidocr' ? t('On-Device') :
                                             settings.ocrProvider === 'ocrspace' ? 'OCR.space' : 'Google Cloud'}
                                        </span>
                                    </div>
                                )}
                                {settings.ocrProvider === 'rapidocr' && (
                                    <div style={{ marginLeft: '22px', marginBottom: '6px' }}>
                                        {providerStatus?.rapidocr_downloaded && (
                                            <div style={{ color: '#666', fontSize: '10px' }}>
                                                {t("Installed model:")} RapidOCR{providerStatus?.rapidocr_info?.version ? ` v${providerStatus.rapidocr_info.version}` : ''}
                                            </div>
                                        )}
                                        <div style={{ color: '#666', fontSize: '10px', display: 'flex', alignItems: 'center' }}>
                                            {providerStatus?.rapidocr_downloading ? (
                                                <>
                                                    <InstallingDot />
                                                    <span>{t("Installing...")}</span>
                                                </>
                                            ) : (
                                                <>
                                                    <StatusDot ok={!!providerStatus?.rapidocr_downloaded} />
                                                    <span>{providerStatus?.rapidocr_downloaded ? t('Ready') : t('Not ready (Model not installed)')}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {settings.ocrProvider === 'chromescreenai' && (
                                    <div style={{ marginLeft: '22px', marginBottom: '6px' }}>
                                        {providerStatus?.chromescreenai_downloaded && (
                                            <div style={{ color: '#666', fontSize: '10px', marginBottom: '4px' }}>{t("Engine:")} Chrome Screen AI</div>
                                        )}
                                        <div style={{ color: '#666', fontSize: '10px', display: 'flex', alignItems: 'center' }}>
                                            {providerStatus?.chromescreenai_downloading ? (
                                                <>
                                                    <InstallingDot />
                                                    <span>{t("Installing...")}</span>
                                                </>
                                            ) : (
                                                <>
                                                    <StatusDot ok={!!providerStatus?.chromescreenai_downloaded} />
                                                    <span>{providerStatus?.chromescreenai_downloaded ? t('Ready') : t('Not ready (Engine not installed)')}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {settings.ocrProvider === 'googlecloud' && (
                                    <div style={{ marginLeft: '22px', marginBottom: '6px' }}>
                                        <ReachabilityRow result={webReachability?.ocr} expectedProvider="googlecloud" />
                                    </div>
                                )}
                                {settings.ocrProvider === 'ocrspace' && (
                                    <div style={{ marginLeft: '22px', marginBottom: '6px' }}>
                                        <div style={{ color: '#666', fontSize: '10px', marginBottom: '4px' }}>{t("Free, no API key needed")}</div>
                                        {providerStatus?.ocr_usage && (
                                            <>
                                                <div style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    marginBottom: '3px'
                                                }}>
                                                    <span style={{ color: '#666', fontSize: '10px' }}>
                                                        {t("10 min limit:")}
                                                    </span>
                                                    <span style={{
                                                        fontSize: '10px',
                                                        color: providerStatus.ocr_usage.rate_remaining <= 2 ? '#ff6b6b' : '#888'
                                                    }}>
                                                        {providerStatus.ocr_usage.rate_remaining}/{providerStatus.ocr_usage.rate_limit}
                                                    </span>
                                                </div>
                                                <div style={{
                                                    height: '3px',
                                                    backgroundColor: 'rgba(255,255,255,0.1)',
                                                    borderRadius: '2px',
                                                    overflow: 'hidden',
                                                    marginBottom: '4px'
                                                }}>
                                                    <div style={{
                                                        height: '100%',
                                                        width: `${(providerStatus.ocr_usage.rate_remaining / providerStatus.ocr_usage.rate_limit) * 100}%`,
                                                        backgroundColor: providerStatus.ocr_usage.rate_remaining <= 2
                                                            ? '#ff6b6b'
                                                            : providerStatus.ocr_usage.rate_remaining <= 5
                                                                ? '#ffa726'
                                                                : '#4caf50',
                                                        borderRadius: '2px',
                                                        transition: 'width 0.3s ease'
                                                    }} />
                                                </div>
                                                {providerStatus.ocr_usage.rate_remaining === 0 && providerStatus.ocr_usage.rate_reset_seconds > 0 && (
                                                    <div style={{ color: '#ff6b6b', fontSize: '10px', marginBottom: '4px' }}>
                                                        {t('Rate limit exceeded - resets in {minutes} min', { minutes: Math.ceil(providerStatus.ocr_usage.rate_reset_seconds / 60) })}
                                                    </div>
                                                )}

                                                <div style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    marginBottom: '3px'
                                                }}>
                                                    <span style={{ color: '#666', fontSize: '10px' }}>
                                                        {t("Daily limit:")}
                                                    </span>
                                                    <span style={{
                                                        fontSize: '10px',
                                                        color: providerStatus.ocr_usage.remaining < 50 ? '#ff6b6b' : '#888'
                                                    }}>
                                                        {providerStatus.ocr_usage.remaining}/{providerStatus.ocr_usage.limit}
                                                    </span>
                                                </div>
                                                <div style={{
                                                    height: '3px',
                                                    backgroundColor: 'rgba(255,255,255,0.1)',
                                                    borderRadius: '2px',
                                                    overflow: 'hidden',
                                                    marginBottom: '4px'
                                                }}>
                                                    <div style={{
                                                        height: '100%',
                                                        width: `${(providerStatus.ocr_usage.remaining / providerStatus.ocr_usage.limit) * 100}%`,
                                                        backgroundColor: providerStatus.ocr_usage.remaining < 50
                                                            ? '#ff6b6b'
                                                            : providerStatus.ocr_usage.remaining < 100
                                                                ? '#ffa726'
                                                                : '#4caf50',
                                                        borderRadius: '2px',
                                                        transition: 'width 0.3s ease'
                                                    }} />
                                                </div>
                                                {providerStatus.ocr_usage.remaining < 50 && (
                                                    <div style={{ color: '#ff6b6b', fontSize: '10px', marginBottom: '4px' }}>
                                                        {t("Low daily requests remaining")}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        <ReachabilityRow result={webReachability?.ocr} expectedProvider="ocrspace" />
                                    </div>
                                )}
                                {settings.ocrProvider !== 'legacy_gemini_vision' && (
                                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                                        <BsTranslate style={{ marginRight: '8px', color: '#aaa' }} />
                                        <span style={{ color: '#888' }}>{t("Translation:")}</span>
                                        <span style={{ marginLeft: '6px', fontWeight: 'bold' }}>
                                            {selectedEndpoint?.name ?? t('LLM endpoint not configured')}
                                        </span>
                                    </div>
                                )}
                                <div style={{ marginLeft: '22px', marginBottom: '6px' }}>
                                    {settings.ocrProvider === 'legacy_gemini_vision' && (
                                        <>
                                            <div style={{ color: '#666', fontSize: '10px' }}>
                                                {t("Model:")} {settings.geminiModel.replace(/^gemini-/, '').split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                            </div>
                                            <ReachabilityRow result={webReachability?.ocr} expectedProvider="legacy_gemini_vision" />
                                        </>
                                    )}
                                    {settings.ocrProvider !== 'legacy_gemini_vision' && selectedEndpoint && (
                                        <div style={{ color: '#666', fontSize: '10px' }}>
                                            {selectedEndpoint.model} · {selectedEndpoint.visionEnabled ? t('Annotated vision') : t('Text only')}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </PanelSectionRow>
                    </>
                )}

            </PanelSection>
        </div>
    );
};
