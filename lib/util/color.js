const enabled = process.env.NO_COLOR === undefined && process.stdout.isTTY;

export const green = (s) => enabled ? `\x1b[32m${s}\x1b[0m` : s;
export const red = (s) => enabled ? `\x1b[31m${s}\x1b[0m` : s;
export const yellow = (s) => enabled ? `\x1b[33m${s}\x1b[0m` : s;
export const bold = (s) => enabled ? `\x1b[1m${s}\x1b[0m` : s;
export const dim = (s) => enabled ? `\x1b[2m${s}\x1b[0m` : s;
