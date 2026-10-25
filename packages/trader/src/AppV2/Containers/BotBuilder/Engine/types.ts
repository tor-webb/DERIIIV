export type TLevel = 'info' | 'success' | 'warn' | 'error';

export type TValue = number | boolean | string;

export type TDataKind =
    | 'tick'
    | 'last_digit'
    | 'balance'
    | 'balance_text'
    | 'total_profit'
    | 'total_runs'
    | 'sell_available'
    | 'result_win'
    | 'result_loss'
    | 'detail_contract_id'
    | 'detail_contract_type'
    | 'detail_buy_price'
    | 'detail_payout'
    | 'detail_profit'
    | 'detail_sell_price';

export type TExpr =
    | { t: 'num'; v: number }
    | { t: 'bool'; v: boolean }
    | { t: 'str'; v: string }
    | { t: 'var'; name: string }
    | { t: 'data'; kind: TDataKind }
    | { t: 'cmp'; op: 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE'; a: TExpr; b: TExpr }
    | { t: 'logic'; op: 'AND' | 'OR'; a: TExpr; b: TExpr }
    | { t: 'not'; a: TExpr }
    | { t: 'arith'; op: 'ADD' | 'MINUS' | 'MULTIPLY' | 'DIVIDE' | 'POWER'; a: TExpr; b: TExpr }
    | { t: 'single'; op: 'ROOT' | 'ABS' | 'NEG' | 'LN' | 'LOG10' | 'EXP' | 'POW10'; a: TExpr }
    | { t: 'mod'; a: TExpr; b: TExpr }
    | { t: 'round'; op: 'ROUND' | 'ROUNDUP' | 'ROUNDDOWN'; a: TExpr }
    | { t: 'rand'; from: TExpr; to: TExpr }
    | { t: 'join'; parts: TExpr[] }
    | { t: 'call'; name: string; args: TExpr[] };

export type TStmt =
    | { t: 'if'; branches: { cond: TExpr; body: TStmt[] }[]; otherwise: TStmt[] }
    | { t: 'set'; name: string; value: TExpr }
    | { t: 'notify'; level: TLevel; message: TExpr }
    | { t: 'purchase'; contract_type: string }
    | { t: 'sell' }
    | { t: 'trade_again' }
    | { t: 'repeat'; times: TExpr; body: TStmt[] }
    | { t: 'while'; until: boolean; cond: TExpr; body: TStmt[] }
    | { t: 'flow'; kind: 'BREAK' | 'CONTINUE' }
    | { t: 'timeout'; seconds: TExpr; body: TStmt[] }
    | { t: 'call'; name: string; args: TExpr[] }
    | { t: 'return'; cond: TExpr | null; value: TExpr | null };

export type TProcedure = {
    name: string;
    params: string[];
    body: TStmt[];
    /** Value of a function that returns something; null for a procedure. */
    returns: TExpr | null;
};

export type TTradeSetup = {
    symbol: string;
    trade_type: string;
    /** `both` lets the purchase block choose; otherwise the only contract the bot may buy. */
    contract_type: string;
    candle_interval: number;
    restart_buy_sell: boolean;
    restart_on_error: boolean;
};

export type TTradeOptions = {
    duration_unit: string;
    duration: TExpr;
    amount: TExpr;
    /** Digit prediction. Null for trade types that have none. */
    prediction: TExpr | null;
};

export type TProgram = {
    setup: TTradeSetup;
    options: TTradeOptions;
    /** Runs once when the bot starts. */
    init: TStmt[];
    /** Runs on every tick until a contract is bought. */
    before_purchase: TStmt[];
    /** Runs on every update of the open contract. */
    during_purchase: TStmt[];
    /** Runs once when a contract has finished. */
    after_purchase: TStmt[];
    procedures: Record<string, TProcedure>;
};

/** What the runner sends to the API for one trade. */
export type TTradeRequest = {
    amount: number;
    basis: 'stake';
    contract_type: string;
    currency: string;
    underlying_symbol: string;
    duration: number;
    duration_unit: string;
    /** Digit prediction, as a string, the way the platform's own proposals send it. */
    barrier?: string;
};

export type TSubscription = { unsubscribe: () => void };

/* eslint-disable @typescript-eslint/no-explicit-any */
export type TApiResponse = Record<string, any>;

/** The slice of the trading socket the runner needs. Lets the runner be tested without a network. */
export type TBotApi = {
    subscribeTicks: (symbol: string, cb: (response: TApiResponse) => void) => TSubscription;
    subscribeProposal: (request: TTradeRequest, cb: (response: TApiResponse) => void) => TSubscription;
    buy: (proposal_id: string, price: number) => Promise<TApiResponse>;
    subscribeOpenContract: (contract_id: number, cb: (response: TApiResponse) => void) => TSubscription;
    sell: (contract_id: number, price: number) => Promise<TApiResponse>;
};

export type TBotStats = {
    runs: number;
    won: number;
    lost: number;
    total_profit: number;
    total_stake: number;
    total_payout: number;
};

export type TTransaction = {
    contract_id: number;
    contract_type: string;
    /** The market the contract was bought on, such as `1HZ100V`. */
    symbol: string;
    buy_price: number;
    payout: number;
    profit: number;
    /** Entry and exit spot as the API displays them. Empty until the API has reported them. */
    entry_spot: string;
    exit_spot: string;
    /** `open` until the contract is sold or expires. */
    status: 'open' | 'won' | 'lost';
    time: string;
};

/** The contract the bot is following right now, for the live card in the Summary tab. */
export type TLiveContract = {
    contract_id: number;
    contract_type: string;
    symbol: string;
    buy_price: number;
    profit: number;
    /** What the contract could be sold for now. */
    current_value: number;
    payout: number;
    resale_offered: boolean;
    /** Ticks seen so far and in total, for tick contracts. `tick_total` is 0 for other durations. */
    tick_current: number;
    tick_total: number;
};

export type TRunStatus = 'idle' | 'running' | 'stopping' | 'stopped';

export type TRunLimits = {
    /** Stop after this many finished trades. */
    max_trades?: number;
    /** Stop (stop loss) once the total loss reaches this amount (a positive number). */
    max_loss?: number;
    /** Stop (take profit) once the total profit reaches this amount (a positive number). */
    max_profit?: number;
    /**
     * Keep trading until a limit above is hit, even when the restart conditions do not ask to trade again.
     * The page turns this on whenever a take profit or stop loss is set.
     */
    keep_running?: boolean;
};
