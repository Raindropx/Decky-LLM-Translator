import { DialogButton, Focusable, Navigation } from '@decky/ui';
import { VFC } from 'react';
import { HiArrowTopRightOnSquare } from 'react-icons/hi2';
import { t } from './i18n';

const DECKY_PLUGIN_STORE_URL = 'https://plugins.deckbrew.xyz/';

export const ApiKeyTransferHint: VFC = () => (
    <div style={{ color: '#9aa0a6', fontSize: '12px', lineHeight: 1.45, marginTop: '8px' }}>
        <div>
            {t('Tip: Copy the API key on another device, then send the clipboard to your Steam Deck with Decky LocalSend (recommended for Gaming Mode) or KDE Connect and paste it here.')}
        </div>
        <div style={{ marginTop: '4px' }}>{t('Only send API keys between devices you trust.')}</div>
        <Focusable style={{ display: 'flex', marginTop: '6px' }}>
            <DialogButton
                onClick={() => Navigation.NavigateToExternalWeb(DECKY_PLUGIN_STORE_URL)}
                style={{ minWidth: 'unset', padding: '6px 10px', fontSize: '12px' }}
            >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <HiArrowTopRightOnSquare /> {t('Decky Store: search “Decky LocalSend”')}
                </span>
            </DialogButton>
        </Focusable>
    </div>
);
