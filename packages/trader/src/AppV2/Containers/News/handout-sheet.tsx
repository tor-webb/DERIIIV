import React from 'react';

import { getBrandName } from '@deriv/shared';
import { localize } from '@deriv-com/translations';

import { getHandoutChecklist, getHandoutTerms, TNewsItem, TRecommendation } from './news-utils';

import './handout-sheet.scss';

type THandoutSheetProps = { items: TNewsItem[]; recommendations: TRecommendation[] };

/** One-page handout. Shown on the News page and rendered again under <body> so printing gives only this sheet. */
const HandoutSheet = ({ items, recommendations }: THandoutSheetProps) => {
    const checklist = React.useMemo(getHandoutChecklist, []);
    const terms = React.useMemo(getHandoutTerms, []);

    return (
        <div className='news-sheet'>
            <h2 className='news-sheet__title'>{localize('{{brand}} trader handout', { brand: getBrandName() })}</h2>
            <p className='news-sheet__date'>{new Date().toLocaleDateString(undefined, { dateStyle: 'full' })}</p>

            <h3 className='news-sheet__heading'>{localize('Headlines to know today')}</h3>
            {items.length ? (
                <ul className='news-sheet__list'>
                    {items.map(item => (
                        <li key={item.id}>
                            {item.title} <em>({item.source})</em>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className='news-sheet__text'>
                    {localize('No headlines loaded. Check the News page for today’s list.')}
                </p>
            )}

            <h3 className='news-sheet__heading'>{localize('Before you trade the news')}</h3>
            <ul className='news-sheet__list news-sheet__list--check'>
                {checklist.map(line => (
                    <li key={line}>{line}</li>
                ))}
            </ul>

            <h3 className='news-sheet__heading'>{localize('What to consider now')}</h3>
            <ul className='news-sheet__list'>
                {recommendations.slice(0, 3).map(rec => (
                    <li key={rec.id}>
                        <strong>{rec.title}.</strong> {rec.text}
                    </li>
                ))}
            </ul>

            <h3 className='news-sheet__heading'>{localize('Words you will hear')}</h3>
            <dl className='news-sheet__terms'>
                {terms.map(entry => (
                    <div key={entry.term}>
                        <dt>{entry.term}</dt>
                        <dd>{entry.meaning}</dd>
                    </div>
                ))}
            </dl>

            <p className='news-sheet__foot'>
                {localize(
                    'Education only, not financial advice. Headlines come from public news sites and link to the original story. Trading can lose you money.'
                )}
            </p>
        </div>
    );
};

export default HandoutSheet;
