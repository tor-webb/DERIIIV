import React from 'react';

import { localize } from '@deriv-com/translations';

import { MAX_SAVED_BOT_NAME_LENGTH } from './saved-bots';

import './templates-panel.scss';

type TSaveTemplateDialogProps = {
    onSave: (name: string) => void;
    onCancel: () => void;
};

/** Asks for a name before the bot on the workspace is kept in this browser as a template. */
const SaveTemplateDialog = ({ onSave, onCancel }: TSaveTemplateDialogProps) => {
    const [name, setName] = React.useState('');
    const input_ref = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => input_ref.current?.focus(), []);

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        if (name.trim()) onSave(name);
    };

    return (
        <form
            className='save-template'
            role='dialog'
            aria-label={localize('Save as template')}
            data-testid='dt_bot_save_template'
            onSubmit={submit}
            onKeyDown={event => event.key === 'Escape' && onCancel()}
        >
            <label className='save-template__label'>
                <span>{localize('Name this bot')}</span>
                <input
                    ref={input_ref}
                    className='save-template__input'
                    type='text'
                    value={name}
                    maxLength={MAX_SAVED_BOT_NAME_LENGTH}
                    placeholder={localize('For example: My steady Rise/Fall')}
                    data-testid='dt_bot_save_template_name'
                    onChange={event => setName(event.target.value)}
                />
            </label>
            <span className='save-template__hint'>
                {localize('It is kept in this browser only. Saving under the same name replaces the earlier bot.')}
            </span>
            <span className='save-template__actions'>
                <button
                    type='submit'
                    className='save-template__button'
                    disabled={!name.trim()}
                    data-testid='dt_bot_save_template_submit'
                >
                    {localize('Save')}
                </button>
                <button
                    type='button'
                    className='save-template__button save-template__button--ghost'
                    data-testid='dt_bot_save_template_cancel'
                    onClick={onCancel}
                >
                    {localize('Cancel')}
                </button>
            </span>
        </form>
    );
};

export default SaveTemplateDialog;
