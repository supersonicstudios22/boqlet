// Types for local-stack.mjs (plain Node, so run.mjs can import it too).
export function isLocal(): boolean;
export function localOrigin(): string;
export function localPassword(): string;
export function quote(s: unknown): string;
export function sql(query: string): string;
export function setupLink(email: string): string;
export function resetAuthLimits(): string;
export function createAccount(apiUrl: string, name: string, email: string): Promise<string>;
export function settleMail(): Promise<number>;
