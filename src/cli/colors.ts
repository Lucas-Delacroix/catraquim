const NO_COLOR =
  !process.stdout.isTTY ||
  process.env.NO_COLOR !== undefined ||
  process.env.TERM === 'dumb';

const c =
  (open: string, close: string) =>
  (s: string): string =>
    NO_COLOR ? s : `\x1b[${open}m${s}\x1b[${close}m`;

export const bold = c('1', '22');
export const dim = c('2', '22');
export const red = c('31', '39');
export const green = c('32', '39');
export const yellow = c('33', '39');
export const cyan = c('36', '39');
export const orange = c('38;5;208', '39');
export const gray = c('38;5;245', '39');
