export type TLevel = 'info' | 'success' | 'warn' | 'error';

export type TDataKind =
    | 'last_tick'
    | 'last_digit'
    | 'balance'
    | 'total_profit'
    | 'current_profit'
    | 'sell_available'
    | 'last_result_win'
    | 'last_result_loss';

export type TExpr =
    | { t: 'num'; v: number }
    | { t: 'bool'; v: boolean }
    | { t: 'var'; name: string }
    | { t: 'data'; kind: TDataKind }
    | { t: 'cmp'; op: 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE'; a: TExpr; b: TExpr }
    | { t: 'logic'; op: 'AND' | 'OR'; a: TExpr; b: TExpr }
    | { t: 'not'; a: TExpr }
    | { t: 'arith'; op: 'ADD' | 'MINUS' | 'MULTIPLY' | 'DIVIDE' | 'POWER'; a: TExpr; b: TExpr }
    | { t: 'single'; op: 'ROOT' | 'ABS' | 'NEG' | 'LN' | 'LOG10' | 'EXP' | 'POW10'; a: TExpr }
    | { t: 'rand'; from: TExpr; to: TExpr };

export type TStmt =
    | { t: 'if'; branches: { cond: TExpr; body: TStmt[] }[]; otherwise: TStmt[] }
    | { t: 'set'; name: string; value: TExpr }
    | { t: 'notify'; level: TLevel; message: string }
    | { t: 'purchase'; contract_type: string }
    | { t: 'sell' }
    | { t: 'trade_again' };

export type TTradeParams = {
    symbol: string;
    contract_type: string;
    duration: number;
    duration_unit: string;
    stake: number;
};

export type TProgram = {
    trade: TTradeParams;
    purchase: TStmt[];
    sell: TStmt[];
    restart: TStmt[];
};

export type TSubscription = { unsubscribe: () => void };

/* eslint-disable @typescript-eslint/no-explicit-any */
export type TApiResponse = Record<string, any>;

/** The slice of the trading socket the runner needs. Lets the runner be tested without a network. */
export type TBotApi = {
    subscribeTicks: (symbol: string, cb: (response: TApiResponse) => void) => TSubscription;
    subscribeProposal: (request: Record<string, unknown>, cb: (response: TApiResponse) => void) => TSubscription;
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
};

export type TRunStatus = 'idle' | 'running' | 'stopping' | 'stopped';

export type TRunLimits = {
    /** Stop after this many finished trades. */
    max_trades?: number;
    /** Stop once the total loss reaches this amount (a positive number). */
    max_loss?: number;
};
