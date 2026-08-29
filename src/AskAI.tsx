import { call } from '@decky/api';
import {
    DialogButton,
    Focusable,
    ModalRoot,
    ShowModalResult,
    TextField,
    showModal,
} from '@decky/ui';
import { ReactNode, VFC, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HiOutlineCursorArrowRays, HiOutlinePlus, HiPaperAirplane, HiTrash } from 'react-icons/hi2';
import {
    AskAIComposerPart,
    AskAIComposerState,
    AskAIRequestPart,
    AskAIScreenRegion,
    MAX_ASK_AI_QUESTION_CHARS,
} from './AskAIState';
import {
    ImageState,
    RegionSelectionCancelReason,
    SelectedTranslatedRegion,
} from './Overlay';
import { logger } from './Logger';
import { t } from './i18n';

type AskAIStatus = 'editing' | 'sending' | 'answered' | 'error';
const MODAL_TEARDOWN_SETTLE_MS = 250;
const SIDE_MENU_POLL_MS = 50;
const SIDE_MENU_MAX_CLOSE_ATTEMPTS = 12;

interface SteamMenuStoreLike {
    CloseSideMenus?: () => void;
    GetOpenSideMenu?: () => number;
    IsAnySideMenuVisible?: () => boolean;
    m_eOpenSideMenu?: number;
}

interface SteamUIStoreLike {
    CloseSideMenus?: () => void;
    GetFocusedWindowInstance?: () => { MenuStore?: SteamMenuStoreLike } | undefined;
}

interface AskAIResponse {
    answer?: string;
    reasoning?: string;
    error?: string;
    message?: string;
}

interface AskAISession {
    id: number;
    revision: number;
    screenshotData: string;
    screenRegions: AskAIScreenRegion[];
    displayRegionContextIndices: number[];
    composer: AskAIComposerState;
    status: AskAIStatus;
    answer: string;
    reasoning: string;
    reasoningExpanded: boolean;
    error: string;
}

type AskAIListener = () => void;

export class AskAIController {
    private readonly imageState: ImageState;
    private readonly isVisionEnabled: () => boolean;
    private session: AskAISession | null = null;
    private modal: ShowModalResult | null = null;
    private listeners: AskAIListener[] = [];
    private nextSessionId = 1;
    private requestGeneration = 0;

    constructor(imageState: ImageState, isVisionEnabled: () => boolean = () => false) {
        this.imageState = imageState;
        this.isVisionEnabled = isVisionEnabled;
    }

    canOpen(): boolean {
        return this.imageState.getAskAIOverlaySnapshot() !== null;
    }

    canSelectReferences(): boolean {
        const snapshot = this.imageState.getAskAIOverlaySnapshot();
        return Boolean(
            snapshot
            && this.session
            && snapshot.revision === this.session.revision
            && snapshot.regions.length > 0
        );
    }

    open(): boolean {
        const snapshot = this.imageState.getAskAIOverlaySnapshot();
        if (!snapshot) return false;

        if (!this.session || this.session.revision !== snapshot.revision) {
            this.requestGeneration++;
            this.session = {
                id: this.nextSessionId++,
                revision: snapshot.revision,
                screenshotData: snapshot.imageData,
                screenRegions: snapshot.contextRegions.map((region, index) => ({
                    id: `region-${index + 1}`,
                    originalText: region.text,
                    translatedText: region.translatedText || region.text,
                    rect: { ...region.rect },
                })),
                displayRegionContextIndices: snapshot.displayRegionContextIndices,
                composer: new AskAIComposerState(),
                status: 'editing',
                answer: '',
                reasoning: '',
                reasoningExpanded: false,
                error: '',
            };
        }

        this.showComposer();
        return true;
    }

    getSession(): AskAISession | null {
        return this.session;
    }

    subscribe(listener: AskAIListener): () => void {
        this.listeners.push(listener);
        return () => {
            const index = this.listeners.indexOf(listener);
            if (index !== -1) this.listeners.splice(index, 1);
        };
    }

    updateTextPart(partId: string, text: string, caretOffset?: number): void {
        this.session?.composer.updateTextPart(partId, text, caretOffset);
        this.notify();
    }

    setInsertionAnchor(partId: string, offset: number): void {
        this.session?.composer.setInsertionAnchor(partId, offset);
    }

    removeReference(partId: string): void {
        this.session?.composer.removeReference(partId);
        this.notify();
    }

    startNewQuestion(): void {
        const session = this.session;
        if (!session) return;

        this.requestGeneration++;
        session.composer.reset();
        session.status = 'editing';
        session.answer = '';
        session.reasoning = '';
        session.reasoningExpanded = false;
        session.error = '';
        this.notify();
    }

    toggleReasoning(): void {
        const session = this.session;
        if (!session?.reasoning) return;
        session.reasoningExpanded = !session.reasoningExpanded;
        this.notify();
    }

    beginSelection(): void {
        const session = this.session;
        if (!session || session.status === 'sending') return;

        this.closeComposer();
        window.setTimeout(() => {
            if (this.session?.id !== session.id) return;
            this.closeSteamMenusBeforeSelection(session, 0, 0);
        }, MODAL_TEARDOWN_SETTLE_MS);
    }

    async send(): Promise<void> {
        const session = this.session;
        if (!session || session.status === 'sending' || !session.composer.hasQuestionText()) return;

        const snapshot = this.imageState.getAskAIOverlaySnapshot();
        if (!snapshot || snapshot.revision !== session.revision) {
            session.status = 'error';
            session.error = t('The translated screen is no longer available');
            this.notify();
            return;
        }

        session.status = 'sending';
        session.answer = '';
        session.reasoning = '';
        session.reasoningExpanded = false;
        session.error = '';
        const requestGeneration = ++this.requestGeneration;
        const sessionId = session.id;
        this.notify();

        try {
            const response = await call<
                [AskAIScreenRegion[], AskAIRequestPart[], string | null],
                AskAIResponse
            >(
                'ask_ai',
                session.screenRegions,
                session.composer.toRequestParts(),
                this.isVisionEnabled() ? session.screenshotData : null,
            );
            if (!this.isCurrentRequest(sessionId, requestGeneration)) return;

            if (!response?.answer?.trim()) {
                throw new Error(response?.message || response?.error || t('No answer was returned'));
            }
            session.answer = response.answer;
            session.reasoning = response.reasoning?.trim() || '';
            session.reasoningExpanded = false;
            session.status = 'answered';
        } catch (error) {
            if (!this.isCurrentRequest(sessionId, requestGeneration)) return;
            session.status = 'error';
            session.error = error instanceof Error ? error.message : t('Ask AI failed');
            logger.error('AskAI', 'Ask AI request failed', error);
        }
        this.notify();
    }

    close(): void {
        this.closeComposer();
    }

    invalidateScreen(): void {
        this.requestGeneration++;
        this.session = null;
        this.closeComposer();
        this.imageState.cancelRegionSelection('stale');
        this.notify();
    }

    cleanup(): void {
        this.invalidateScreen();
        this.listeners = [];
    }

    private completeSelection(sessionId: number, selected: SelectedTranslatedRegion[]): void {
        const session = this.session;
        if (!session || session.id !== sessionId) return;

        const references = selected.flatMap(({ index }): AskAIScreenRegion[] => {
            const contextIndex = session.displayRegionContextIndices[index];
            const region = session.screenRegions[contextIndex];
            return region ? [region] : [];
        });
        session.composer.insertReferences(references);
        this.notify();
        window.setTimeout(() => this.showComposer(), 0);
    }

    private closeSteamMenusBeforeSelection(
        session: AskAISession,
        attempt: number,
        consecutiveClosedChecks: number,
    ): void {
        if (this.session?.id !== session.id) return;

        // Closing a global modal makes Steam restore the Quick Access menu that
        // was open underneath it. Target the owning Steam UI store only after
        // that restoration, and verify the menu is actually gone before the
        // selection overlay starts accepting input.
        const steamUIStore = (window as unknown as { SteamUIStore?: SteamUIStoreLike }).SteamUIStore;
        const menuStore = steamUIStore?.GetFocusedWindowInstance?.()?.MenuStore;
        steamUIStore?.CloseSideMenus?.();
        menuStore?.CloseSideMenus?.();

        const openSideMenu = menuStore?.GetOpenSideMenu?.() ?? menuStore?.m_eOpenSideMenu;
        const anyMenuVisible = menuStore?.IsAnySideMenuVisible?.();
        const canObserveMenu = openSideMenu !== undefined || anyMenuVisible !== undefined;
        const menuIsClosed = canObserveMenu
            && (openSideMenu === undefined || openSideMenu === 0)
            && (anyMenuVisible === undefined || anyMenuVisible === false);
        const nextClosedChecks = menuIsClosed ? consecutiveClosedChecks + 1 : 0;

        if (nextClosedChecks >= 2 || (!canObserveMenu && attempt >= 1) || attempt >= SIDE_MENU_MAX_CLOSE_ATTEMPTS) {
            this.imageState.beginRegionSelection(
                session.revision,
                (selected) => this.completeSelection(session.id, selected),
                (reason) => this.cancelSelection(session.id, reason),
            );
            return;
        }

        window.setTimeout(() => {
            this.closeSteamMenusBeforeSelection(session, attempt + 1, nextClosedChecks);
        }, SIDE_MENU_POLL_MS);
    }

    private cancelSelection(sessionId: number, reason: RegionSelectionCancelReason): void {
        const session = this.session;
        if (!session || session.id !== sessionId) return;

        if (reason === 'stale') {
            this.requestGeneration++;
            session.status = 'error';
            session.error = t('The translated screen is no longer available');
        }
        this.notify();
        window.setTimeout(() => this.showComposer(), 0);
    }

    private showComposer(): void {
        if (!this.session || this.modal) return;
        this.modal = showModal(
            <AskAIModal controller={this} />,
            undefined,
            {
                strTitle: t('Ask AI'),
                bHideActionIcons: true,
                bHideMainWindowForPopouts: false,
                bNeverPopOut: true,
                popupWidth: window.innerWidth,
                popupHeight: window.innerHeight,
            },
        );
    }

    private closeComposer(): void {
        const modal = this.modal;
        this.modal = null;
        modal?.Close();
    }

    private isCurrentRequest(sessionId: number, requestGeneration: number): boolean {
        return this.session?.id === sessionId && this.requestGeneration === requestGeneration;
    }

    private notify(): void {
        for (const listener of this.listeners) listener();
    }
}

const ReferenceCard: VFC<{
    part: Extract<AskAIComposerPart, { type: 'reference' }>;
    number: number;
    onRemove: () => void;
}> = ({ part, number, onRemove }) => {
    const [expanded, setExpanded] = useState(false);
    const clampStyle = expanded ? {} : {
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical' as const,
        WebkitLineClamp: 2,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    };

    return (
        <div style={{
            margin: '8px 0',
            padding: '10px 12px',
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
            borderLeft: '4px solid #66b6ff',
            borderRadius: '6px',
            background: 'rgba(102, 182, 255, 0.10)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: 0 }}>
                <strong style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{t('Reference')} {number}</strong>
                <DialogButton
                    onClick={onRemove}
                    aria-label={`${t('Remove reference')} ${number}`}
                    style={{ minWidth: '42px', width: '42px', padding: '6px' }}
                >
                    <HiTrash />
                </DialogButton>
            </div>
            <div onClick={() => setExpanded(value => !value)} style={{ cursor: 'pointer', marginTop: '6px', minWidth: 0, overflowWrap: 'anywhere' }}>
                <div style={{ opacity: 0.72, fontSize: '12px', marginBottom: '2px' }}>{t('Original')}</div>
                <div style={clampStyle}>{part.originalText}</div>
                <div style={{ opacity: 0.72, fontSize: '12px', margin: '7px 0 2px' }}>{t('Translation')}</div>
                <div style={clampStyle}>{part.translatedText}</div>
                <div style={{ opacity: 0.6, fontSize: '11px', marginTop: '5px' }}>
                    {expanded ? t('Click to collapse') : t('Click to expand')}
                </div>
            </div>
        </div>
    );
};

const MarkdownAnswer: VFC<{ answer: string }> = ({ answer }) => (
    <div className='ask-ai-markdown' style={{
        marginTop: '14px',
        padding: '12px 14px',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        borderRadius: '8px',
        background: 'rgba(255, 255, 255, 0.06)',
        overflowWrap: 'anywhere',
    }}>
        <style>{`
            .ask-ai-markdown > :first-child { margin-top: 0; }
            .ask-ai-markdown > :last-child { margin-bottom: 0; }
            .ask-ai-markdown pre { overflow-x: auto; padding: 10px; background: rgba(0,0,0,.35); border-radius: 6px; }
            .ask-ai-markdown code { font-family: monospace; }
            .ask-ai-markdown blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid #66b6ff; opacity: .9; }
            .ask-ai-markdown table { border-collapse: collapse; max-width: 100%; }
            .ask-ai-markdown th, .ask-ai-markdown td { border: 1px solid rgba(255,255,255,.25); padding: 5px 8px; }
        `}</style>
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
                img: () => null,
                a: ({ href, children }: { href?: string; children?: ReactNode }) => {
                    const safeHref = href && /^https?:\/\//i.test(href) ? href : '';
                    return safeHref ? (
                        <a
                            href={safeHref}
                            onClick={(event) => {
                                event.preventDefault();
                                SteamClient.System.OpenInSystemBrowser(safeHref);
                            }}
                        >
                            {children}
                        </a>
                    ) : <span>{children}</span>;
                },
            }}
        >
            {answer}
        </ReactMarkdown>
    </div>
);

const ReasoningPanel: VFC<{
    reasoning: string;
    expanded: boolean;
    onToggle: () => void;
}> = ({ reasoning, expanded, onToggle }) => (
    <div style={{
        marginTop: '14px',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: '8px',
        background: 'rgba(255, 255, 255, 0.035)',
        overflow: 'hidden',
    }}>
        <DialogButton
            onClick={onToggle}
            aria-expanded={expanded}
            style={{
                width: '100%',
                minWidth: 0,
                padding: '9px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: '8px',
                borderRadius: 0,
                background: 'transparent',
            }}
        >
            <span aria-hidden='true'>{expanded ? '▾' : '▸'}</span>
            <span>{t('Thinking process')}</span>
        </DialogButton>
        {expanded && (
            <div style={{
                padding: '10px 14px 13px',
                borderTop: '1px solid rgba(255, 255, 255, 0.10)',
                opacity: 0.78,
                fontSize: '13px',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
            }}>
                {reasoning}
            </div>
        )}
    </div>
);

const AskAIModal: VFC<{ controller: AskAIController }> = ({ controller }) => {
    const [, setVersion] = useState(0);
    useEffect(() => controller.subscribe(() => setVersion(value => value + 1)), [controller]);

    const session = controller.getSession();
    if (!session) return null;

    let referenceNumber = 0;
    return (
        <ModalRoot
            onCancel={() => controller.close()}
            onEscKeypress={() => controller.close()}
            className='ask-ai-fullscreen-root'
            modalClassName='ask-ai-fullscreen-modal'
            bAllowFullSize
        >
            <style>{`
                .ask-ai-fullscreen-modal {
                    position: fixed !important;
                    inset: 0 !important;
                    transform: none !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    max-width: none !important;
                    max-height: none !important;
                    margin: 0 !important;
                    border-radius: 0 !important;
                    box-sizing: border-box !important;
                }
                .ask-ai-fullscreen-root {
                    width: 100vw !important;
                    height: 100vh !important;
                    max-width: none !important;
                    max-height: none !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    overflow: hidden !important;
                    box-sizing: border-box !important;
                }
            `}</style>
            <div style={{
                width: '100vw',
                height: '100vh',
                maxWidth: '100vw',
                maxHeight: '100vh',
                padding: '20px 28px 16px',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                background: 'linear-gradient(180deg, rgba(24, 37, 54, 0.98), rgba(13, 23, 35, 0.98))',
            }}>
                <Focusable style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '18px',
                    flexShrink: 0,
                    paddingBottom: '12px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.14)',
                }}>
                    <div style={{ minWidth: 0 }}>
                        <h2 style={{ margin: 0 }}>{t('Ask about the current screen')}</h2>
                        <div style={{ opacity: 0.75, marginTop: '5px' }}>
                            {t('Type a question and insert screen references wherever they are useful.')}
                        </div>
                    </div>
                    <DialogButton
                        onClick={() => controller.startNewQuestion()}
                        style={{ width: 'auto', minWidth: '136px', flexShrink: 0 }}
                    >
                        <HiOutlinePlus style={{ marginRight: '6px' }} />
                        {t('New question')}
                    </DialogButton>
                </Focusable>

                <Focusable
                    flow-children='vertical'
                    style={{
                        flex: '1 1 auto',
                        minWidth: 0,
                        minHeight: 0,
                        overflowX: 'hidden',
                        overflowY: 'auto',
                        padding: '14px 4px 16px 0',
                    }}
                >
                    {session.composer.getParts().map((part) => {
                        if (part.type === 'reference') {
                            referenceNumber++;
                            return (
                                <ReferenceCard
                                    key={part.id}
                                    part={part}
                                    number={referenceNumber}
                                    onRemove={() => controller.removeReference(part.id)}
                                />
                            );
                        }

                        return (
                            <TextField
                                key={part.id}
                                label={t('Question')}
                                value={part.text}
                                disabled={session.status === 'sending'}
                                placeholder={t('Ask a question about the game text')}
                                style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                                onChange={(event) => controller.updateTextPart(
                                    part.id,
                                    event.target.value,
                                    event.target.selectionStart ?? event.target.value.length,
                                )}
                                onClick={(event) => controller.setInsertionAnchor(
                                    part.id,
                                    event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                                )}
                                onKeyUp={(event) => controller.setInsertionAnchor(
                                    part.id,
                                    event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                                )}
                                onFocus={(event) => controller.setInsertionAnchor(
                                    part.id,
                                    event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                                )}
                            />
                        );
                    })}

                    <div style={{ opacity: 0.6, fontSize: '11px', marginTop: '6px' }}>
                        {t('Question limit')}: {MAX_ASK_AI_QUESTION_CHARS}
                    </div>

                    {session.error && (
                        <div style={{ color: '#ff8a80', marginTop: '12px' }}>{session.error}</div>
                    )}
                    {session.reasoning && (
                        <ReasoningPanel
                            reasoning={session.reasoning}
                            expanded={session.reasoningExpanded}
                            onToggle={() => controller.toggleReasoning()}
                        />
                    )}
                    {session.answer && (
                        <>
                            <h3 style={{ marginBottom: 0 }}>{t('AI Answer')}</h3>
                            <MarkdownAnswer answer={session.answer} />
                        </>
                    )}
                </Focusable>

                <Focusable style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '10px',
                    flexShrink: 0,
                    paddingTop: '12px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.14)',
                }}>
                    <DialogButton
                        onClick={() => controller.beginSelection()}
                        disabled={session.status === 'sending' || !controller.canSelectReferences()}
                    >
                        <HiOutlineCursorArrowRays style={{ marginRight: '6px' }} />
                        {t('Add screen references')}
                    </DialogButton>
                    <DialogButton
                        onClick={() => void controller.send()}
                        disabled={session.status === 'sending' || !session.composer.hasQuestionText()}
                    >
                        <HiPaperAirplane style={{ marginRight: '6px' }} />
                        {session.status === 'sending' ? t('Asking…') : t('Send')}
                    </DialogButton>
                </Focusable>
            </div>
        </ModalRoot>
    );
};
