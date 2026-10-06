// Fixture: proves `owner-path-no-reasoning` also covers API routes. The freeze route is an
// owner-path module and must work with the reasoning layer dead (I7) — it may never import it.
import { propose } from '../../../../../packages/reasoning/src/index';

export const violation = propose;
