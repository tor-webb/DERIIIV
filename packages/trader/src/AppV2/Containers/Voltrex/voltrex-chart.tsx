import React from 'react';

import { localize } from '@deriv-com/translations';

import { bollingerSeries, emaSeries, TCandle } from './voltrex-indicators';

const WIDTH = 640;
const HEIGHT = 260;
const PAD = { top: 10, right: 54, bottom: 18, left: 6 };
export const VISIBLE_CANDLES = 70;

type TProps = {
    candles: TCandle[];
    support: number | null;
    resistance: number | null;
    ema_fast_period?: number;
    ema_slow_period?: number;
};

const decimalsFor = (value: number) => {
    if (Math.abs(value) >= 1000) return 2;
    return Math.abs(value) >= 10 ? 3 : 5;
};

const path = (points: (number | null)[], x: (index: number) => number, y: (value: number) => number) => {
    let output = '';
    points.forEach((value, index) => {
        if (value === null) return;
        output += `${output ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)} `;
    });
    return output.trim();
};

/**
 * A candlestick chart with the 20 and 50 averages, the Bollinger Bands and the nearest support and resistance. It draws
 * the same candles the analysis used, so what is on the chart is what produced the signal. Averages are worked out over
 * the whole loaded history, then only the newest candles are shown.
 */
const VoltrexChart = ({ candles, support, resistance, ema_fast_period = 20, ema_slow_period = 50 }: TProps) => {
    const drawing = React.useMemo(() => {
        if (candles.length < 2) return null;
        const closes = candles.map(candle => candle.close);
        const start = Math.max(0, candles.length - VISIBLE_CANDLES);
        const shown = candles.slice(start);
        const fast = emaSeries(closes, ema_fast_period).slice(start);
        const slow = emaSeries(closes, ema_slow_period).slice(start);
        const bands = bollingerSeries(closes, 20, 2).slice(start);

        const values = [
            ...shown.flatMap(candle => [candle.high, candle.low]),
            ...bands.flatMap(band => (band ? [band.upper, band.lower] : [])),
        ];
        let low = Math.min(...values);
        let high = Math.max(...values);
        // levels far from the price would flatten the candles, so they only count when they are near
        const span = high - low || Math.abs(high) * 0.001 || 1;
        [support, resistance].forEach(level => {
            if (level !== null && level > low - span * 0.5 && level < high + span * 0.5) {
                low = Math.min(low, level);
                high = Math.max(high, level);
            }
        });
        const margin = (high - low) * 0.04 || 1;
        const min = low - margin;
        const max = high + margin;
        const plot_width = WIDTH - PAD.left - PAD.right;
        const plot_height = HEIGHT - PAD.top - PAD.bottom;
        const step = plot_width / shown.length;
        const x = (index: number) => PAD.left + step * index + step / 2;
        const y = (value: number) => PAD.top + ((max - value) / (max - min)) * plot_height;
        return { shown, fast, slow, bands, x, y, step, min, max };
    }, [candles, support, resistance, ema_fast_period, ema_slow_period]);

    if (!drawing) {
        return <div className='voltrex-chart voltrex-chart--empty'>{localize('Waiting for candles…')}</div>;
    }
    const { shown, fast, slow, bands, x, y, step, min, max } = drawing;
    const body_width = Math.max(1.5, step * 0.62);
    const labels = [max, (max + min) / 2, min];
    const decimals = decimalsFor(max);
    const inside = (level: number | null) => level !== null && level > min && level < max;

    return (
        <svg
            className='voltrex-chart'
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role='img'
            aria-label={localize('Candlestick chart with moving averages, Bollinger Bands, support and resistance')}
            preserveAspectRatio='none'
        >
            {labels.map(label => (
                <g key={label}>
                    <line
                        className='voltrex-chart__grid'
                        x1={PAD.left}
                        x2={WIDTH - PAD.right}
                        y1={y(label)}
                        y2={y(label)}
                    />
                    <text className='voltrex-chart__label' x={WIDTH - PAD.right + 4} y={y(label) + 3}>
                        {label.toFixed(decimals)}
                    </text>
                </g>
            ))}
            <path
                className='voltrex-chart__band'
                d={path(
                    bands.map(band => band?.upper ?? null),
                    x,
                    y
                )}
            />
            <path
                className='voltrex-chart__band'
                d={path(
                    bands.map(band => band?.lower ?? null),
                    x,
                    y
                )}
            />
            {inside(resistance) && (
                <line
                    className='voltrex-chart__level voltrex-chart__level--resistance'
                    x1={PAD.left}
                    x2={WIDTH - PAD.right}
                    y1={y(resistance as number)}
                    y2={y(resistance as number)}
                    data-testid='voltrex-chart-resistance'
                />
            )}
            {inside(support) && (
                <line
                    className='voltrex-chart__level voltrex-chart__level--support'
                    x1={PAD.left}
                    x2={WIDTH - PAD.right}
                    y1={y(support as number)}
                    y2={y(support as number)}
                    data-testid='voltrex-chart-support'
                />
            )}
            {shown.map((candle, index) => {
                const is_up = candle.close >= candle.open;
                return (
                    <g
                        key={candle.epoch}
                        className={is_up ? 'voltrex-chart__candle--up' : 'voltrex-chart__candle--down'}
                    >
                        <line x1={x(index)} x2={x(index)} y1={y(candle.high)} y2={y(candle.low)} />
                        <rect
                            x={x(index) - body_width / 2}
                            y={Math.min(y(candle.open), y(candle.close))}
                            width={body_width}
                            height={Math.max(1, Math.abs(y(candle.open) - y(candle.close)))}
                        />
                    </g>
                );
            })}
            <path className='voltrex-chart__ema voltrex-chart__ema--fast' d={path(fast, x, y)} />
            <path className='voltrex-chart__ema voltrex-chart__ema--slow' d={path(slow, x, y)} />
        </svg>
    );
};

export default VoltrexChart;
