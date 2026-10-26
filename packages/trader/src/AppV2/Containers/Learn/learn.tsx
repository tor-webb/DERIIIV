import React from 'react';
import { useHistory } from 'react-router-dom';

import { getBrandName, getCommunityConfig } from '@deriv/shared';
import { observer } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import { getChecklist, getGlossary, getTopics } from './learn-content';

import './learn.scss';

const GLOSSARY_TAB = 'glossary';

type TCommunityCardProps = { url: string; name: string };

const CommunityCard = ({ url, name }: TCommunityCardProps) => (
    <section className='learn__community' data-testid='dt_learn_community'>
        <h2 className='learn__community-title'>{name}</h2>
        <p className='learn__community-text'>
            {localize('Share what you learn, ask questions and follow trading ideas with other {{brand}} traders.', {
                brand: getBrandName(),
            })}
        </p>
        {url ? (
            <a
                className='learn__button'
                data-testid='dt_learn_telegram_link'
                href={url}
                target='_blank'
                rel='noopener noreferrer'
            >
                {localize('Join us on Telegram')}
            </a>
        ) : (
            <p className='learn__soon' data-testid='dt_learn_telegram_soon'>
                {localize('Our Telegram channel is opening soon. The link will appear here.')}
            </p>
        )}
        <ul className='learn__rules'>
            <li>{localize('Nobody here can promise profits. Ideas shared are not advice.')}</li>
            <li>{localize('Never send money, passwords or codes to anyone, even if they say they are staff.')}</li>
            <li>{localize('Staff will not message you first to ask for money or to take over your account.')}</li>
        </ul>
    </section>
);

const Learn = observer(() => {
    const history = useHistory();
    const topics = React.useMemo(getTopics, []);
    const glossary = React.useMemo(getGlossary, []);
    const checklist = React.useMemo(getChecklist, []);
    const { telegram_url, telegram_name } = getCommunityConfig();

    const [tab, setTab] = React.useState(topics[0].id);
    const [search, setSearch] = React.useState('');
    const [checked, setChecked] = React.useState<Record<string, boolean>>({});

    const topic = topics.find(item => item.id === tab);
    const query = search.trim().toLowerCase();
    const matches = glossary.filter(
        entry => !query || entry.term.toLowerCase().includes(query) || entry.meaning.toLowerCase().includes(query)
    );
    const ready = checklist.every(item => checked[item.id]);

    return (
        <main className='learn' data-testid='dt_learn'>
            <section className='learn__header'>
                <h1 className='learn__title'>{localize('Learn to trade')}</h1>
                <p className='learn__subtitle'>
                    {localize(
                        'Plain-English lessons on reading markets, news and risk. Start at the beginning and practise on a demo account.'
                    )}
                </p>
            </section>

            <p className='learn__notice' data-testid='dt_learn_notice'>
                {localize(
                    'This is education, not advice. Nobody, including us, can predict where a price will go. You can lose money on every trade.'
                )}
            </p>

            <div className='learn__tabs' role='tablist' aria-label={localize('Lesson topics')}>
                {[
                    ...topics.map(item => ({ id: item.id, label: item.label })),
                    { id: GLOSSARY_TAB, label: localize('Glossary') },
                ].map(item => (
                    <button
                        key={item.id}
                        type='button'
                        role='tab'
                        aria-selected={tab === item.id}
                        data-testid={`dt_learn_tab_${item.id}`}
                        className={`learn__tab${tab === item.id ? ' learn__tab--active' : ''}`}
                        onClick={() => setTab(item.id)}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            <div className='learn__content' role='tabpanel'>
                {topic && (
                    <React.Fragment>
                        <p className='learn__intro'>{topic.intro}</p>
                        <div className='learn__lessons'>
                            {topic.lessons.map(lesson => (
                                <article
                                    key={lesson.id}
                                    className='learn__lesson'
                                    data-testid={`dt_learn_lesson_${lesson.id}`}
                                >
                                    <h2 className='learn__lesson-title'>{lesson.title}</h2>
                                    <p className='learn__lesson-summary'>{lesson.summary}</p>
                                    {lesson.body.map(paragraph => (
                                        <p key={paragraph} className='learn__text'>
                                            {paragraph}
                                        </p>
                                    ))}
                                    <ul className='learn__points'>
                                        {lesson.points.map(point => (
                                            <li key={point}>{point}</li>
                                        ))}
                                    </ul>
                                    {lesson.try_it && (
                                        <button
                                            type='button'
                                            className='learn__try'
                                            data-testid={`dt_learn_try_${lesson.id}`}
                                            onClick={() => history.push(lesson.try_it?.path ?? '/')}
                                        >
                                            {lesson.try_it.label}
                                        </button>
                                    )}
                                </article>
                            ))}
                        </div>
                    </React.Fragment>
                )}

                {tab === GLOSSARY_TAB && (
                    <React.Fragment>
                        <label className='learn__search' htmlFor='learn_search'>
                            <span className='learn__search-label'>{localize('Search the glossary')}</span>
                            <input
                                id='learn_search'
                                data-testid='dt_learn_search'
                                className='learn__input'
                                type='search'
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                            />
                        </label>
                        {matches.length ? (
                            <dl className='learn__glossary' data-testid='dt_learn_glossary'>
                                {matches.map(entry => (
                                    <div key={entry.term} className='learn__term'>
                                        <dt>{entry.term}</dt>
                                        <dd>{entry.meaning}</dd>
                                    </div>
                                ))}
                            </dl>
                        ) : (
                            <p className='learn__soon' data-testid='dt_learn_no_match'>
                                {localize('No terms match "{{search}}".', { search })}
                            </p>
                        )}
                    </React.Fragment>
                )}
            </div>

            <section className='learn__checklist' data-testid='dt_learn_checklist'>
                <h2 className='learn__community-title'>{localize('Before every trade')}</h2>
                {checklist.map(item => (
                    <label key={item.id} className='learn__check' htmlFor={`learn_check_${item.id}`}>
                        <input
                            id={`learn_check_${item.id}`}
                            data-testid={`dt_learn_check_${item.id}`}
                            type='checkbox'
                            checked={!!checked[item.id]}
                            onChange={event =>
                                setChecked(previous => ({ ...previous, [item.id]: event.target.checked }))
                            }
                        />
                        {item.text}
                    </label>
                ))}
                <p
                    className={`learn__ready learn__ready--${ready ? 'yes' : 'no'}`}
                    data-testid='dt_learn_ready'
                    aria-live='polite'
                >
                    {ready
                        ? localize('All ticked. You have thought it through.')
                        : localize('Tick each line honestly. If you cannot, wait.')}
                </p>
            </section>

            <CommunityCard url={telegram_url} name={telegram_name} />
        </main>
    );
});

export default Learn;
