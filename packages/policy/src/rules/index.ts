// The rule catalogue as a static, ordered array (POLICY_ENGINE §6). `evaluate` runs ALL of them,
// every time: no short-circuit, so the audit row shows every reason a decision was taken.
import { R00 } from './R00';
import { R01 } from './R01';
import { R02 } from './R02';
import { R03 } from './R03';
import { R04 } from './R04';
import { R05 } from './R05';
import { R06 } from './R06';
import { R07 } from './R07';
import { R08 } from './R08';
import { R09 } from './R09';
import { R10 } from './R10';
import { R11 } from './R11';
import { R12 } from './R12';
import { R13 } from './R13';
import { R14 } from './R14';
import { R15 } from './R15';
import { R16 } from './R16';
import { R17 } from './R17';
import { R18 } from './R18';
import { R19 } from './R19';
import { R20 } from './R20';
import { R21 } from './R21';
import type { Rule } from './kit';

export const RULES: readonly Rule[] = [
  R00,
  R01,
  R02,
  R03,
  R04,
  R05,
  R06,
  R07,
  R08,
  R09,
  R10,
  R11,
  R12,
  R13,
  R14,
  R15,
  R16,
  R17,
  R18,
  R19,
  R20,
  R21,
] as const;

export {
  R00,
  R01,
  R02,
  R03,
  R04,
  R05,
  R06,
  R07,
  R08,
  R09,
  R10,
  R11,
  R12,
  R13,
  R14,
  R15,
  R16,
  R17,
  R18,
  R19,
  R20,
  R21,
};
export type { Rule } from './kit';
