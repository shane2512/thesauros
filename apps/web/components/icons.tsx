// One icon family (lucide, 1.75px stroke, rounded) behind our own names, so screens never import a
// vendor glyph directly and a family swap stays a one-file change.
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Ban,
  Bell,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Coins,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Fingerprint,
  Fuel,
  Gauge,
  Gavel,
  Inbox,
  Landmark,
  Lock,
  LockKeyhole,
  Palette,
  PenLine,
  PiggyBank,
  Plus,
  Radar,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Snowflake,
  Terminal,
  TrendingUp,
  User,
  UserPlus,
  Users,
  Vault,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

export type IconProps = { className?: string };
export type IconComponent = (p: IconProps) => ReactNode;

const S = (I: LucideIcon): IconComponent =>
  function Icon({ className }: IconProps) {
    return <I className={className} strokeWidth={1.75} aria-hidden="true" focusable="false" />;
  };

export const IconApprovals = S(Inbox);
export const IconRecipients = S(UserPlus);
export const IconPeople = S(Users);
export const IconActivity = S(Activity);
export const IconLedger = S(ReceiptText);
export const IconAdd = S(Plus);
export const IconChevron = S(ChevronRight);
export const IconChevronDown = S(ChevronDown);
export const IconBack = S(ArrowLeft);
export const IconForward = S(ArrowRight);
export const IconOutward = S(ArrowUpRight);
export const IconClose = S(X);
export const IconSearch = S(Search);
export const IconExternal = S(ExternalLink);
export const IconVault = S(Vault);
export const IconWallet = S(Wallet);
export const IconHome = S(Landmark);
export const IconSettings = S(Settings);
export const IconDoc = S(FileText);
export const IconShield = S(Shield);
export const IconShieldCheck = S(ShieldCheck);
export const IconShieldAlert = S(ShieldAlert);
export const IconBell = S(Bell);
export const IconRevoke = S(Ban);
export const IconLock = S(Lock);
export const IconFreeze = S(LockKeyhole);
export const IconSnow = S(Snowflake);
export const IconCopy = S(Copy);
export const IconCheck = S(Check);
export const IconBadge = S(BadgeCheck);
export const IconRefresh = S(RefreshCw);
export const IconReset = S(RotateCcw);
export const IconAgent = S(Bot);
export const IconBrain = S(BrainCircuit);
export const IconCode = S(Code);
export const IconRadar = S(Radar);
export const IconSavings = S(PiggyBank);
export const IconGavel = S(Gavel);
export const IconGauge = S(Gauge);
export const IconGas = S(Fuel);
export const IconBolt = S(Zap);
export const IconPalette = S(Palette);
export const IconTerminal = S(Terminal);
export const IconFingerprint = S(Fingerprint);
export const IconSign = S(PenLine);
export const IconTrend = S(TrendingUp);
export const IconHomeward = S(ArrowDownToLine);
export const IconDownload = S(Download);
export const IconCoins = S(Coins);
export const IconUser = S(User);

/** Verdict glyph: three non-colour channels: filled disc, outlined ring, disc with slash. */
export type VerdictTone = 'allow' | 'escalate' | 'deny';

export function VerdictGlyph({ tone, className }: { tone: VerdictTone; className?: string }) {
  if (tone === 'escalate') {
    return (
      <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      {tone === 'allow' ? (
        <path d="M4.6 8.2l2.3 2.3 4.5-4.7" fill="none" stroke="var(--th-card)" strokeWidth="2" />
      ) : (
        <path d="M4.6 4.6l6.8 6.8" fill="none" stroke="var(--th-card)" strokeWidth="2" />
      )}
    </svg>
  );
}
