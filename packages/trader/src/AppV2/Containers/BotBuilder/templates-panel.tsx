import React from 'react';
import classNames from 'classnames';

import { localize } from '@deriv-com/translations';

import { TBotMarket } from './bot-markets';
import { getBotTemplates, TBotTemplate, TTemplateLevel, TTemplateRisk } from './templates';

import './templates-panel.scss';

type TTemplatesPanelProps = {
    /** Importing replaces the bot on the workspace, so it is switched off while a bot is running. */
    is_disabled: boolean;
    /** True once a template has replaced the user's bot and that bot can still be brought back. */
    can_restore: boolean;
    /** A market picked on the Markets page. The bots are built for it; without one each bot uses its own market. */
    market?: TBotMarket | null;
    onClearMarket?: () => void;
    onImport: (template: TBotTemplate) => void;
    onRestore: () => void;
    onClose: () => void;
};

const LEVEL_TEXT: Record<TTemplateLevel, () => string> = {
    beginner: () => localize('Beginner'),
    intermediate: () => localize('Intermediate'),
};

const RISK_TEXT: Record<TTemplateRisk, () => string> = {
    low: () => localize('Lower risk'),
    medium: () => localize('Medium risk'),
    high: () => localize('High risk'),
};

const TemplatesPanel = ({
    is_disabled,
    can_restore,
    market = null,
    onClearMarket,
    onImport,
    onRestore,
    onClose,
}: TTemplatesPanelProps) => {
    const symbol = market?.symbol;
    const templates = React.useMemo(() => getBotTemplates(symbol), [symbol]);

    return (
        <aside
            className='templates-panel'
            role='dialog'
            aria-label={localize('Bot templates')}
            data-testid='dt_bot_templates'
        >
            <header className='templates-panel__header'>
                <div>
                    <h2 className='templates-panel__title'>{localize('Bot templates')}</h2>
                    <p className='templates-panel__subtitle'>
                        {localize('Pick one to load it into the builder. You can change every block afterwards.')}
                    </p>
                </div>
                <button
                    type='button'
                    className='templates-panel__close'
                    aria-label={localize('Close templates')}
                    onClick={onClose}
                >
                    ×
                </button>
            </header>

            <p className='templates-panel__notice'>
                {localize(
                    'Templates are examples to learn from, not advice. No bot beats the odds, and every trade can lose its stake. Try them on a demo account first.'
                )}
            </p>

            {market && (
                <div className='templates-panel__market' data-testid='dt_bot_templates_market'>
                    <span>
                        {localize('Bots for {{name}}.', { name: market.name })}
                        {market.group === 'forex' &&
                            ` ${localize('Forex has no digit or tick contracts, so these bots use 5 minute Rise/Fall contracts.')}`}
                    </span>
                    {onClearMarket && (
                        <button type='button' className='templates-panel__link' onClick={onClearMarket}>
                            {localize('Show all markets')}
                        </button>
                    )}
                </div>
            )}

            {can_restore && (
                <div className='templates-panel__restore' data-testid='dt_bot_templates_restore'>
                    <span>{localize('Your previous bot was replaced.')}</span>
                    <button type='button' className='templates-panel__link' onClick={onRestore}>
                        {localize('Bring it back')}
                    </button>
                </div>
            )}

            <ul className='templates-panel__list'>
                {templates.map(template => (
                    <li
                        key={template.id}
                        className='templates-panel__card'
                        data-testid={`dt_bot_template_${template.id}`}
                    >
                        <div className='templates-panel__card-top'>
                            <h3 className='templates-panel__card-title'>{template.name}</h3>
                            <span className='templates-panel__tags'>
                                <span className='templates-panel__tag'>{LEVEL_TEXT[template.level]()}</span>
                                <span
                                    className={classNames(
                                        'templates-panel__tag',
                                        `templates-panel__tag--${template.risk}`
                                    )}
                                >
                                    {RISK_TEXT[template.risk]()}
                                </span>
                            </span>
                        </div>
                        <p className='templates-panel__text'>{template.description}</p>
                        <ul className='templates-panel__facts'>
                            {template.facts.map(fact => (
                                <li key={fact} className='templates-panel__fact'>
                                    {fact}
                                </li>
                            ))}
                        </ul>
                        <p className='templates-panel__caution'>{template.caution}</p>
                        <button
                            type='button'
                            className='templates-panel__import'
                            disabled={is_disabled}
                            data-testid={`dt_bot_template_import_${template.id}`}
                            onClick={() => onImport(template)}
                        >
                            {localize('Import')}
                        </button>
                    </li>
                ))}
            </ul>
        </aside>
    );
};

export default TemplatesPanel;
