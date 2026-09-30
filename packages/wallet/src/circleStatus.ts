// Circle transaction state constants, shared by executor.ts's confirmExecution and provision.ts's
// circleTxSender — split out so neither imports the other (dependency-cruiser's no-circular rule).
export const CIRCLE_TERMINAL_SUCCESS = new Set(['CONFIRMED', 'COMPLETE']);
export const CIRCLE_TERMINAL_FAILURE = new Set(['CANCELLED', 'DENIED', 'FAILED']);
