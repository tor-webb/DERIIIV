import React from 'react';
import classNames from 'classnames';

import { localize } from '@deriv-com/translations';

import { getBotTemplates, TBotTemplate, TTemplateLevel, TTemplateRisk } from './templates';

import './templates-panel.scss';

type TTemplatesPanelProps = {
    /** Importing replaces the bot on the workspace, so it is switched off while a bot is running. */
    is_disabled: boolean;
    /** True once a template has replaced the user's bot and that bot can still be brought back. */
    can_restore: boolean;
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

const TemplatesPanel = ({ is_disabled, can_restore, onImport, onRestore, onClose }: TTemplatesPanelProps) => {
    const templates = React.useMemo(() => getBotTemplates(), []);

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
