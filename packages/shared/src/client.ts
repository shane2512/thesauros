// Browser-safe subset of @thesauros/shared: no env, no logger (pino), nothing that reads process.env.
// The web UI imports this entry (`@thesauros/shared/client`) so client bundles stay free of server code.
export * from './result';
export * from './money';
export * from './address';
export * from './ceilings';
export * from './schemas';
