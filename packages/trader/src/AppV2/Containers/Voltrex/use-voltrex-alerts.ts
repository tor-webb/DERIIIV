import React from 'react';

import { localize } from '@deriv-com/translations';

import type { TScanRow } from './use-voltrex-scanner';
import {
    dueHits,
    findHits,
    loadRules,
    loadSound,
    MAX_RECENT,
    MAX_RULES,
    saveRules,
    saveSound,
    TAlertHit,
    TAlertRule,
    validateRule,
} from './voltrex-alerts';
import type { TDigitStats } from './voltrex-digits';

export type TFiredAlert = TAlertHit & { at: number };

/** A short beep. Browsers only allow sound after the person has clicked something on the page. */
export const beep = () => {
    try {
        const Context =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) return;
        const context = new Context();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 880;
        gain.gain.value = 0.05;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.18);
        oscillator.onended = () => context.close();
    } catch {
        // no sound is not a reason to lose the alert
    }
};

export const useVoltrexAlerts = (
    rows: TScanRow[],
    getStats: (symbol: string) => TDigitStats | null,
    digits_version: number
) => {
    const [rules, setRules] = React.useState<TAlertRule[]>(loadRules);
    const [sound, setSoundState] = React.useState<boolean>(loadSound);
    const [fired, setFired] = React.useState<TFiredAlert[]>([]);
    const last = React.useRef(new Map<string, number>());

    const addRule = React.useCallback(
        (rule: TAlertRule): string | null => {
            const problem = validateRule(rule);
            if (problem) return problem;
            if (rules.length >= MAX_RULES) return localize('You can keep up to {{max}} alerts.', { max: MAX_RULES });
            const next = [...rules, rule];
            setRules(next);
            saveRules(next);
            return null;
        },
        [rules]
    );

    const removeRule = React.useCallback((id: string) => {
        setRules(current => {
            const next = current.filter(rule => rule.id !== id);
            saveRules(next);
            return next;
        });
    }, []);

    const setSound = React.useCallback((on: boolean) => {
        setSoundState(on);
        saveSound(on);
    }, []);

    const clearFired = React.useCallback(() => setFired([]), []);

    React.useEffect(() => {
        if (!rules.length || !rows.length) return;
        const due = dueHits(findHits(rules, rows, getStats), last.current, Date.now());
        if (!due.length) return;
        const at = Date.now();
        setFired(current => [...due.map(hit => ({ ...hit, at })), ...current].slice(0, MAX_RECENT));
        if (sound) beep();
        // the rows and the digit feeds are the change signals
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, rules, digits_version]);

    return { rules, addRule, removeRule, sound, setSound, fired, clearFired };
};
