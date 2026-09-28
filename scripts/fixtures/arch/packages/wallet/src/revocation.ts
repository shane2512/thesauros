// Fixture: proves `owner-path-no-reasoning` is enforced. The out-of-band revocation recorder is an
// owner-path module and must work with the whole reasoning layer dead (I7) — it may never import it.
import { propose } from '../../reasoning/src/index';

export const violation = propose;
