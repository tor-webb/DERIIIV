import { backOff, isRateLimit, waitTurn } from './voltrex-pacer';
import React from 'react';

import { WS } from '@deriv/shared';
import { useStore } from '@deriv/stores';

import type { TBotApi } from '../BotBuilder/Engine/types';

import type { TScanRow } from './use-voltrex-scanner';
import { parseRiseFall, TRiseFallSpec } from './voltrex-contracts';
import { DEFAULT_RISK, emptyRiskState, rollDay, TRiskSettings, TRiskState, validateRisk } from './voltrex-risk';
import type { TAutoConfig, TOrder, TPlaceResult, TTraderSnapshot, VoltrexTrader } from './voltrex-trader';

const RISK_KEY = 'voltrex_risk_settings';
const DAY_KEY = 'voltrex_day_state_';

const read = <T>(key: string): T | null => {
    try {
        const text = window.localStorage.getItem(key);
        return text ? (JSON.parse(text) as T) : null;
    } catch {
        return null;
    }
};

const write = (key: string, value: unknown) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // storage can be blocked; the page then keeps the figures for this visit only
    }
};

/** The saved risk settings, with anything missing or invalid replaced by the defaults. */
export const loadRiskSettings = (): TRiskSettings => {
    const saved = read<Partial<TRiskSettings>>(RISK_KEY) ?? {};
    const merged = { ...DEFAULT_RISK, ...saved };
    return validateRisk(merged) ? DEFAULT_RISK : merged;
};

/** Today's saved figures for this account, or a fresh day. Emergency stop is kept; open trades are not (they cannot be followed after a reload). */
export const loadDayState = (loginid: string): TRiskState => {
    const saved = read<TRiskState>(`${DAY_KEY}${loginid}`);
    if (!saved || typeof saved.realised_profit !== 'number') return emptyRiskState();
    return rollDay({ ...emptyRiskState(saved.day), ...saved, open_stakes: [] });
};

const EMPTY: TTraderSnapshot = { scan: null, trades: [], risk: emptyRiskState(), auto: 'off', log: [] };

type TSpecState = Map<string, Promise<TRiseFallSpec | null>>;

/**
 * Owns the trade controller for the page. The controller (and with it the Bot Builder engine) is loaded the first time
 * it is needed, uses the platform's shared socket, and is shut down when the page closes: anything not yet bought is
 * cancelled and auto-trading stops. Contracts already open keep running on the server and stay in the portfolio.
 */
export const useVoltrexTrader = (rows: TScanRow[]) => {
    const { client } = useStore();
    const { balance, currency, is_virtual } = client;
    const loginid = client.loginid ?? '';
    const [snapshot, setSnapshot] = React.useState<TTraderSnapshot>(EMPTY);
    const [risk, setRisk] = React.useState<TRiskSettings>(loadRiskSettings);
    const trader = React.useRef<VoltrexTrader | null>(null);
    const loading = React.useRef<Promise<VoltrexTrader> | null>(null);
    const specs = React.useRef<TSpecState>(new Map());

    // the controller reads these through refs, so it always sees the latest values without being rebuilt
    const rows_ref = React.useRef(rows);
    const risk_ref = React.useRef(risk);
    const balance_ref = React.useRef(Number(balance) || 0);
    rows_ref.current = rows;
    risk_ref.current = risk;
    balance_ref.current = Number(balance) || 0;

    const updateRisk = React.useCallback((next: TRiskSettings) => {
        setRisk(next);
        if (!validateRisk(next)) write(RISK_KEY, next);
    }, []);

    const getSpec = React.useCallback((symbol: string) => {
        const cached = specs.current.get(symbol);
        if (cached) return cached;
        const request = (async () => {
            try {
                // one turn at a time, and again after a pause if the server said "too many requests"
                let response;
                for (let attempt = 0; attempt < 3; attempt += 1) {
                    // eslint-disable-next-line no-await-in-loop
                    await waitTurn();
                    // eslint-disable-next-line no-await-in-loop
                    response = await WS.storage.contractsFor(symbol);
                    if (!isRateLimit(response)) break;
                    backOff();
                }
                return parseRiseFall(response);
            } catch {
                specs.current.delete(symbol);
                return null;
            }
        })();
        specs.current.set(symbol, request);
        return request;
    }, []);

    const ensure = React.useCallback((): Promise<VoltrexTrader> => {
        if (trader.current) return Promise.resolve(trader.current);
        if (loading.current) return loading.current;
        const created = (async () => {
            const [{ VoltrexTrader: Controller }, { createWsBotApi }] = await Promise.all([
                import(/* webpackChunkName: "voltrex-trader" */ './voltrex-trader'),
                import(/* webpackChunkName: "voltrex-trader" */ '../BotBuilder/Engine/ws-adapter'),
            ]);
            const instance = new Controller({
                api: createWsBotApi(WS) as TBotApi,
                currency,
                is_virtual,
                getBalance: () => balance_ref.current,
                getRisk: () => risk_ref.current,
                getRows: () => rows_ref.current,
                getSpec,
                initial_risk: loadDayState(loginid),
                onChange: next => {
                    setSnapshot(next);
                    write(`${DAY_KEY}${loginid}`, next.risk);
                },
            });
            trader.current = instance;
            setSnapshot(instance.getSnapshot());
            return instance;
        })();
        loading.current = created;
        return created;
    }, [currency, getSpec, is_virtual, loginid]);

    // a different account (or its type) needs a controller of its own
    React.useEffect(
        () => () => {
            trader.current?.dispose();
            trader.current = null;
            loading.current = null;
            setSnapshot(EMPTY);
        },
        [loginid, is_virtual, currency]
    );

    const place = React.useCallback(
        async (order: TOrder, spec: TRiseFallSpec | null): Promise<TPlaceResult> => (await ensure()).place(order, spec),
        [ensure]
    );

    const startAuto = React.useCallback(async (config: TAutoConfig) => (await ensure()).startAuto(config), [ensure]);

    const control = React.useCallback(
        async (action: 'pause' | 'resume' | 'stop' | 'emergency' | 'reset') => {
            const instance = await ensure();
            if (action === 'pause') instance.pauseAuto();
            if (action === 'resume') instance.resumeAuto();
            if (action === 'stop') instance.stopAuto();
            if (action === 'emergency') instance.emergencyStop();
            if (action === 'reset') instance.resetEmergency();
        },
        [ensure]
    );

    const updateAuto = React.useCallback((config: TAutoConfig) => trader.current?.updateAutoConfig(config), []);

    return { snapshot, risk, updateRisk, place, startAuto, control, updateAuto, getSpec, is_virtual, currency };
};
