import React from 'react';

import { getBrandName, getCopyTradingConfig, redirectToLogin, WS } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import {
    createCopyApi,
    getErrorMessage,
    isCopying,
    parseLimits,
    startCopying,
    stopCopying,
    TCopyApi,
} from './copy-trading-api';

import './copy-trading.scss';

type TStatus = 'unknown' | 'idle' | 'copying';

type TCopyTradingProps = {
    /** Only for tests: replaces the live websocket */
    api?: TCopyApi;
};

const CopyTrading = observer(({ api }: TCopyTradingProps) => {
    const { client } = useStore();
    const { is_logged_in, is_virtual, loginid, currency } = client;
    const { enabled, trader_name, trader_token } = getCopyTradingConfig();
    const name = trader_name || getBrandName();

    const [status, setStatus] = React.useState<TStatus>('unknown');
    const [min_stake, setMinStake] = React.useState('');
    const [max_stake, setMaxStake] = React.useState('');
    const [accepted, setAccepted] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState<{ kind: 'error' | 'success'; text: string } | null>(null);

    const copy_api = React.useMemo(() => api ?? createCopyApi(WS), [api]);
    const is_available = enabled && !!trader_token;

    // Find out whether this account is already copying, so the page shows the right button after a reload.
    React.useEffect(() => {
        let cancelled = false;
        if (!is_available || !is_logged_in) {
            setStatus('unknown');
            return undefined;
        }
        isCopying(copy_api, trader_token)
            .then(copying => !cancelled && setStatus(copying ? 'copying' : 'idle'))
            .catch(() => !cancelled && setStatus('idle'));
        return () => {
            cancelled = true;
        };
    }, [copy_api, is_available, is_logged_in, loginid, trader_token]);

    const start = async () => {
        const { limits, error } = parseLimits({ min: min_stake, max: max_stake });
        if (error) {
            setMessage({
                kind: 'error',
                text:
                    error === 'order'
                        ? localize('The smallest stake cannot be above the largest stake.')
                        : localize('Stake limits must be numbers above zero.'),
            });
            return;
        }
        setBusy(true);
        setMessage(null);
        try {
            await startCopying(copy_api, trader_token, limits);
            setStatus('copying');
            setMessage({ kind: 'success', text: localize('You are now copying {{name}}.', { name }) });
        } catch (e) {
            setMessage({ kind: 'error', text: getErrorMessage(e) });
        } finally {
            setBusy(false);
        }
    };

    const stop = async () => {
        setBusy(true);
        setMessage(null);
        try {
            await stopCopying(copy_api, trader_token);
            setStatus('idle');
            setAccepted(false);
            setMessage({ kind: 'success', text: localize('Copying stopped. Trades already open stay open.') });
        } catch (e) {
            setMessage({ kind: 'error', text: getErrorMessage(e) });
        } finally {
            setBusy(false);
        }
    };

    const renderAction = () => {
        if (!is_available) {
            return (
                <p className='copy-trading__notice' data-testid='dt_copy_unavailable'>
                    {localize('Copy trading is not open yet. Check back soon.')}
                </p>
            );
        }
        if (!is_logged_in) {
            return (
                <div className='copy-trading__login'>
                    <p>{localize('Log in with your Deriv account to copy {{name}}.', { name })}</p>
                    <button
                        type='button'
                        className='copy-trading__button'
                        data-testid='dt_copy_login'
                        onClick={() => redirectToLogin()}
                    >
                        {localize('Log in')}
                    </button>
                </div>
            );
        }
        if (status === 'copying') {
            return (
                <div className='copy-trading__active'>
                    <p className='copy-trading__badge' data-testid='dt_copy_active'>
                        {localize('Copying {{name}} on {{loginid}}', { name, loginid })}
                    </p>
                    <button
                        type='button'
                        className='copy-trading__button copy-trading__button--stop'
                        data-testid='dt_copy_stop'
                        disabled={busy}
                        onClick={stop}
                    >
                        {localize('Stop copying')}
                    </button>
                </div>
            );
        }
        return (
            <div className='copy-trading__form'>
                <p className='copy-trading__account' data-testid='dt_copy_account'>
                    {is_virtual
                        ? localize('Copying onto your demo account {{loginid}}.', { loginid })
                        : localize('Copying onto your real account {{loginid}}. Real money is at risk.', { loginid })}
                </p>
                <label className='copy-trading__field' htmlFor='copy_min_stake'>
                    <span>{localize('Smallest stake to copy (optional)')}</span>
                    <input
                        id='copy_min_stake'
                        data-testid='dt_copy_min'
                        type='number'
                        inputMode='decimal'
                        min='0'
                        step='any'
                        value={min_stake}
                        onChange={event => setMinStake(event.target.value)}
                    />
                    <small>{currency}</small>
                </label>
                <label className='copy-trading__field' htmlFor='copy_max_stake'>
                    <span>{localize('Largest stake to copy (optional)')}</span>
                    <input
                        id='copy_max_stake'
                        data-testid='dt_copy_max'
                        type='number'
                        inputMode='decimal'
                        min='0'
                        step='any'
                        value={max_stake}
                        onChange={event => setMaxStake(event.target.value)}
                    />
                    <small>{currency}</small>
                </label>
                <label className='copy-trading__consent' htmlFor='copy_consent'>
                    <input
                        id='copy_consent'
                        data-testid='dt_copy_consent'
                        type='checkbox'
                        checked={accepted}
                        onChange={event => setAccepted(event.target.checked)}
                    />
                    <span>
                        {localize(
                            'I understand that copied trades can lose money, past results do not guarantee future results, and I can stop copying at any time.'
                        )}
                    </span>
                </label>
                <button
                    type='button'
                    className='copy-trading__button'
                    data-testid='dt_copy_start'
                    disabled={!accepted || busy || status === 'unknown'}
                    onClick={start}
                >
                    {localize('Start copying')}
                </button>
            </div>
        );
    };

    return (
        <main className='copy-trading' data-testid='dt_copy_trading'>
            <section className='copy-trading__header'>
                <h1 className='copy-trading__title'>{localize('Copy trading')}</h1>
                <p className='copy-trading__subtitle'>
                    {localize('Mirror the trades of {{name}} on your own account, automatically.', { name })}
                </p>
            </section>

            <section className='copy-trading__card'>
                <h2 className='copy-trading__section-title'>{localize('How it works')}</h2>
                <ol className='copy-trading__steps'>
                    <li>{localize('Log in with your Deriv account.')}</li>
                    <li>
                        {localize('Set a smallest and largest stake if you want to cap the size of copied trades.')}
                    </li>
                    <li>{localize('Press Start copying. Deriv places each new trade on your account for you.')}</li>
                    <li>{localize('Press Stop copying whenever you like.')}</li>
                </ol>
                <p className='copy-trading__fine'>
                    {localize(
                        'Your login stays with Deriv. This site never sees or stores your password or API token.'
                    )}
                </p>
            </section>

            <section className='copy-trading__card'>
                {renderAction()}
                {message && (
                    <p
                        className={`copy-trading__message copy-trading__message--${message.kind}`}
                        role={message.kind === 'error' ? 'alert' : 'status'}
                        data-testid='dt_copy_message'
                    >
                        {message.text}
                    </p>
                )}
            </section>

            <p className='copy-trading__disclaimer'>
                {localize(
                    'Trading derivatives is risky and you can lose all the money you stake. Copy trading does not remove that risk. Only copy with money you can afford to lose.'
                )}
            </p>
        </main>
    );
});

export default CopyTrading;
