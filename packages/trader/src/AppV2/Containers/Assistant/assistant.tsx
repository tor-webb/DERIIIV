import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import classNames from 'classnames';

import { getBrandName, redirectToLogin } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import { getAssistantReply, SUGGESTED_QUESTIONS, TAssistantAction } from './assistant-knowledge';

import './assistant.scss';

type TMessage = { id: number; from: 'bot' | 'user'; text: string; actions?: TAssistantAction[] };

const Assistant = observer(() => {
    const { client } = useStore();
    const { is_logged_in, is_virtual } = client;
    const history = useHistory();
    const location = useLocation();

    const [is_open, setIsOpen] = React.useState(false);
    const [draft, setDraft] = React.useState('');
    const [messages, setMessages] = React.useState<TMessage[]>([]);
    const next_id = React.useRef(1);
    const input_ref = React.useRef<HTMLInputElement>(null);
    const list_ref = React.useRef<HTMLDivElement>(null);

    const ctx = { is_logged_in: !!is_logged_in, is_virtual: !!is_virtual, pathname: location.pathname };

    const push = (message: Omit<TMessage, 'id'>) =>
        setMessages(previous => [...previous, { ...message, id: next_id.current++ }]);

    const open = () => {
        setIsOpen(true);
        if (!messages.length) {
            const reply = getAssistantReply('hello', ctx);
            push({ from: 'bot', text: reply.text, actions: reply.actions });
        }
    };

    const ask = (question: string) => {
        const text = question.trim();
        if (!text) return;
        push({ from: 'user', text });
        const reply = getAssistantReply(text, ctx);
        push({ from: 'bot', text: reply.text, actions: reply.actions });
        setDraft('');
    };

    const runAction = (action: TAssistantAction) => {
        if (action.login) {
            redirectToLogin();
            return;
        }
        if (action.path) {
            history.push(action.path);
            setIsOpen(false);
        }
    };

    React.useEffect(() => {
        if (is_open) input_ref.current?.focus();
    }, [is_open]);

    React.useEffect(() => {
        const list = list_ref.current;
        if (list) list.scrollTop = list.scrollHeight;
    }, [messages, is_open]);

    return (
        <div className='assistant' data-testid='dt_assistant'>
            {is_open && (
                <section
                    className='assistant__panel'
                    role='dialog'
                    aria-label={localize('Site guide')}
                    onKeyDown={event => {
                        if (event.key === 'Escape') setIsOpen(false);
                    }}
                >
                    <header className='assistant__header'>
                        <div>
                            <strong>{localize('{{brand}} guide', { brand: getBrandName() })}</strong>
                            <small>
                                {localize('Answers from a built-in help list, not live AI. Not financial advice.')}
                            </small>
                        </div>
                        <button
                            type='button'
                            className='assistant__close'
                            aria-label={localize('Close guide')}
                            onClick={() => setIsOpen(false)}
                        >
                            ×
                        </button>
                    </header>

                    <div className='assistant__messages' ref={list_ref} aria-live='polite'>
                        {messages.map(message => (
                            <div key={message.id} className={`assistant__message assistant__message--${message.from}`}>
                                <p>{message.text}</p>
                                {!!message.actions?.length && (
                                    <div className='assistant__actions'>
                                        {message.actions.map(action => (
                                            <button key={action.label} type='button' onClick={() => runAction(action)}>
                                                {action.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className='assistant__chips'>
                        {SUGGESTED_QUESTIONS().map(question => (
                            <button key={question} type='button' onClick={() => ask(question)}>
                                {question}
                            </button>
                        ))}
                    </div>

                    <form
                        className='assistant__form'
                        onSubmit={event => {
                            event.preventDefault();
                            ask(draft);
                        }}
                    >
                        <input
                            ref={input_ref}
                            value={draft}
                            onChange={event => setDraft(event.target.value)}
                            placeholder={localize('Ask how to do something…')}
                            aria-label={localize('Your question')}
                            maxLength={200}
                        />
                        <button type='submit' disabled={!draft.trim()}>
                            {localize('Send')}
                        </button>
                    </form>
                </section>
            )}

            <button
                type='button'
                className={classNames('assistant__launcher', { 'assistant__launcher--open': is_open })}
                aria-expanded={is_open}
                aria-label={is_open ? localize('Close guide') : localize('Open site guide')}
                data-testid='dt_assistant_launcher'
                onClick={() => (is_open ? setIsOpen(false) : open())}
            >
                <svg width='22' height='22' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
                    <path d='M4 5h16v11H9l-5 4V5z' stroke='currentColor' strokeWidth='2' strokeLinejoin='round' />
                </svg>
                <span>{localize('Help')}</span>
            </button>
        </div>
    );
});

export default Assistant;
