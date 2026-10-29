import classNames from 'classnames';

import { buildSparklinePoints } from './markets-utils';

type TSparklineProps = {
    values: number[];
    /** Colours the line: green when the window ended higher than it began, red when lower. */
    way: 'up' | 'down' | 'flat';
    width?: number;
    height?: number;
};

const STROKE = { up: '#14663a', down: '#b3261e', flat: 'currentColor' };

/** A tiny price line drawn from the candle closes already loaded. Decorative: the numbers beside it say the same. */
const Sparkline = ({ values, way, width = 96, height = 28 }: TSparklineProps) => {
    const points = buildSparklinePoints(values, width, height);
    if (!points) return <span className='markets__spark markets__spark--empty'>–</span>;
    return (
        <svg
            className={classNames('markets__spark', `markets__spark--${way}`)}
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            preserveAspectRatio='none'
            aria-hidden='true'
            focusable='false'
            data-testid='dt_markets_spark'
        >
            {/* the colour is set here, not in markets.scss, because the Dashboard shows sparklines without that stylesheet */}
            <polyline
                data-testid='dt_markets_spark_line'
                points={points}
                fill='none'
                stroke={STROKE[way]}
                strokeWidth='1.6'
                strokeLinejoin='round'
                strokeLinecap='round'
            />
        </svg>
    );
};

export default Sparkline;
