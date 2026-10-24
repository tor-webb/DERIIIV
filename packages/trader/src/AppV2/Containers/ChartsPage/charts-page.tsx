import React from 'react';
import { observer } from 'mobx-react-lite';

import useDefaultSymbol from 'AppV2/Hooks/useDefaultSymbol';
import { useTraderStore } from 'Stores/useTraderStores';

import { TradeChart } from '../Chart';

import './charts-page.scss';

const ChartsPage = observer(() => {
    const { onMount, onUnmount } = useTraderStore();
    useDefaultSymbol(); // initialises the default symbol so the chart has something to show

    React.useEffect(() => {
        onMount();
        return () => onUnmount();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <main className='charts-page' data-testid='dt_charts_page'>
            <TradeChart />
        </main>
    );
});

export default ChartsPage;
