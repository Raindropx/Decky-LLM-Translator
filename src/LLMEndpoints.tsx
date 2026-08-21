import { call } from '@decky/api';
import {
    ButtonItem,
    DialogButton,
    DropdownItem,
    Focusable,
    ModalRoot,
    PanelSection,
    PanelSectionRow,
    TextField,
    ToggleField,
    showModal,
} from '@decky/ui';
import { VFC, useCallback, useEffect, useState } from 'react';
import { HiDocumentDuplicate, HiEye, HiPencil, HiPlus, HiTrash } from 'react-icons/hi2';
import { ApiKeyTransferHint } from './ApiKeyTransferHint';
import { useSettings } from './SettingsContext';
import { t } from './i18n';

export interface LLMEndpoint {
    id: string;
    name: string;
    provider: 'openai-compatible';
    baseUrl: string;
    model: string;
    visionEnabled: boolean;
    temperature: number;
    maxTokens: number;
    enabled: boolean;
    hasApiKey: boolean;
}

interface EndpointResponse {
    endpoints: LLMEndpoint[];
    selectedEndpointId: string;
}

interface EndpointMutationResponse {
    ok: boolean;
    endpoint?: LLMEndpoint;
    message?: string;
}

const EndpointEditorModal: VFC<{
    endpoint?: LLMEndpoint;
    closeModal?: () => void;
    onSaved: () => void;
}> = ({ endpoint, closeModal, onSaved }) => {
    const [name, setName] = useState(endpoint?.name ?? '');
    const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl ?? 'https://api.openai.com/v1');
    const [model, setModel] = useState(endpoint?.model ?? '');
    const [apiKey, setApiKey] = useState('');
    const [visionEnabled, setVisionEnabled] = useState(endpoint?.visionEnabled ?? false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const save = async () => {
        if (saving) return;
        setSaving(true);
        setError('');
        try {
            const payload: Record<string, unknown> = {
                id: endpoint?.id,
                name: name.trim(),
                provider: 'openai-compatible',
                baseUrl: baseUrl.trim(),
                model: model.trim(),
                visionEnabled,
                temperature: endpoint?.temperature ?? 0.2,
                maxTokens: endpoint?.maxTokens ?? 2048,
                enabled: true,
            };
            if (apiKey.trim()) payload.apiKey = apiKey.trim();

            const result = await call<[Record<string, unknown>], any>('save_llm_endpoint', payload);
            if (!result?.ok) {
                setError(result?.message ? t(result.message) : t('Could not save endpoint'));
                return;
            }
            onSaved();
            closeModal?.();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : t('Could not save endpoint'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalRoot onCancel={closeModal} onEscKeypress={closeModal}>
            <div style={{ padding: '20px', minWidth: '440px' }}>
                <h2>{endpoint ? t('Edit LLM Endpoint') : t('Add LLM Endpoint')}</h2>
                <TextField label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} />
                <TextField label={t("Base URL")} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                <TextField label={t("Model")} value={model} onChange={(e) => setModel(e.target.value)} />
                <TextField
                    label={endpoint?.hasApiKey ? t('API Key (leave blank to keep current key)') : t('API Key')}
                    value={apiKey}
                    bIsPassword
                    bShowClearAction
                    onChange={(e) => setApiKey(e.target.value)}
                />
                <ApiKeyTransferHint />
                <ToggleField
                    label={t("Send Annotated Screenshot")}
                    description={t("Draw OCR IDs on a reference image and send it to the model. Otherwise, only plain text is sent to the model.")}
                    checked={visionEnabled}
                    onChange={setVisionEnabled}
                />
                {baseUrl.trim().toLowerCase().startsWith('http://') && (
                    <div style={{ color: '#ffb74d', marginTop: '8px', fontSize: '12px' }}>
                        {t("HTTP sends the API key, OCR text and optional screenshot without transport encryption.")}
                    </div>
                )}
                {error && <div style={{ color: '#ff6b6b', marginTop: '8px' }}>{error}</div>}
                <Focusable style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '18px' }}>
                    <DialogButton onClick={closeModal}>{t("Cancel")}</DialogButton>
                    <DialogButton onClick={save} disabled={saving}>{saving ? t('Saving…') : t('Save')}</DialogButton>
                </Focusable>
            </div>
        </ModalRoot>
    );
};

export const LLMEndpointSection: VFC<{
    legacyMode: boolean;
}> = ({ legacyMode }) => {
    const { refreshLlmEndpoints } = useSettings();
    const [endpoints, setEndpoints] = useState<LLMEndpoint[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [duplicating, setDuplicating] = useState(false);
    const [actionError, setActionError] = useState('');
    const selected = endpoints.find((endpoint) => endpoint.id === selectedId);

    const refresh = useCallback(async () => {
        const result = await call<[], EndpointResponse>('get_llm_endpoints');
        const nextEndpoints = result?.endpoints ?? [];
        const nextSelected = result?.selectedEndpointId ?? '';
        setEndpoints(nextEndpoints);
        setSelectedId(nextSelected);
        await refreshLlmEndpoints();
    }, [refreshLlmEndpoints]);

    useEffect(() => { refresh(); }, [refresh]);

    const openEditor = (endpoint?: LLMEndpoint) => {
        showModal(<EndpointEditorModal endpoint={endpoint} onSaved={refresh} />);
    };

    const selectEndpoint = async (endpointId: string) => {
        if (await call<[string], boolean>('select_llm_endpoint', endpointId)) {
            setSelectedId(endpointId);
            await refreshLlmEndpoints();
        }
    };

    const deleteSelected = async () => {
        if (!selected) return;
        await call<[string], boolean>('delete_llm_endpoint', selected.id);
        await refresh();
    };

    const duplicateSelected = async () => {
        if (!selected || duplicating) return;
        setDuplicating(true);
        setActionError('');
        try {
            const result = await call<[string], EndpointMutationResponse>(
                'duplicate_llm_endpoint',
                selected.id,
            );
            if (!result?.ok || !result.endpoint) {
                setActionError(result?.message ? t(result.message) : t('Could not copy endpoint'));
                return;
            }
            await refresh();
            openEditor(result.endpoint);
        } catch (duplicateError) {
            setActionError(
                duplicateError instanceof Error ? duplicateError.message : t('Could not copy endpoint'),
            );
        } finally {
            setDuplicating(false);
        }
    };

    return (
        <PanelSection title={t("LLM Translation")}>
            {legacyMode && (
                <PanelSectionRow>
                    <div style={{ color: '#9aa0a6', fontSize: '12px', lineHeight: 1.5 }}>
                        {t("Legacy Gemini Vision currently handles OCR and translation together. Configured LLM endpoints remain available when you switch back to a normal OCR provider.")}
                    </div>
                </PanelSectionRow>
            )}
            <PanelSectionRow>
                <DropdownItem
                    layout="below"
                    label={t("Current LLM Endpoint")}
                    description={selected?.visionEnabled ? t('Annotated screenshot enabled') : t('Text-only context')}
                    rgOptions={endpoints.length ? endpoints.map((endpoint) => ({
                        label: `${endpoint.visionEnabled ? '◉ ' : ''}${endpoint.name}`,
                        data: endpoint.id,
                    })) : [{ label: t('No endpoints configured'), data: '' }]}
                    selectedOption={selectedId}
                    disabled={!endpoints.length || legacyMode}
                    onChange={(option: any) => selectEndpoint(option.data)}
                />
            </PanelSectionRow>
            {selected && (
                <PanelSectionRow>
                    <div style={{ width: '100%', color: '#9aa0a6', fontSize: '12px' }}>
                        <div>{selected.model}</div>
                        <div style={{ wordBreak: 'break-all' }}>{selected.baseUrl}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
                            {selected.visionEnabled && <HiEye />}
                            <span>{selected.hasApiKey ? t('API key configured') : t('No API key (allowed for local endpoints)')}</span>
                        </div>
                    </div>
                </PanelSectionRow>
            )}
            <PanelSectionRow>
                <div style={{ width: '100%' }}>
                    <Focusable
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                            width: '100%',
                            gap: '8px',
                            alignItems: 'stretch',
                        }}
                    >
                        <DialogButton
                            onClick={() => openEditor()}
                            aria-label={t("Add endpoint")}
                            style={{ width: '100%', minWidth: 0, height: '48px', padding: 0 }}
                        >
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                <HiPlus />
                            </span>
                        </DialogButton>
                        <DialogButton
                            onClick={duplicateSelected}
                            disabled={!selected || duplicating}
                            aria-label={t("Copy selected endpoint")}
                            style={{ width: '100%', minWidth: 0, height: '48px', padding: 0 }}
                        >
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                <HiDocumentDuplicate />
                            </span>
                        </DialogButton>
                        <DialogButton
                            onClick={() => openEditor(selected)}
                            disabled={!selected}
                            style={{ width: '100%', minWidth: 0, height: '48px', padding: 0 }}
                        >
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                <HiPencil />
                            </span>
                        </DialogButton>
                        <DialogButton
                            onClick={deleteSelected}
                            disabled={!selected}
                            style={{ width: '100%', minWidth: 0, height: '48px', padding: 0 }}
                        >
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                <HiTrash />
                            </span>
                        </DialogButton>
                    </Focusable>
                    {actionError && (
                        <div style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '6px' }}>
                            {actionError}
                        </div>
                    )}
                </div>
            </PanelSectionRow>
            {!endpoints.length && (
                <PanelSectionRow>
                    <ButtonItem layout="below" onClick={() => openEditor()}>
                        {t("Configure your first OpenAI-compatible endpoint")}
                    </ButtonItem>
                </PanelSectionRow>
            )}
        </PanelSection>
    );
};
