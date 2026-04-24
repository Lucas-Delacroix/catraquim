import { execFile } from 'node:child_process';

export const readMacOsKeychainSecret = async (
  service: string,
  account?: string
) => {
  if (process.platform !== 'darwin') {
    return null;
  }

  return new Promise<string | null>((resolve) => {
    execFile(
      'security',
      [
        'find-generic-password',
        '-s',
        service,
        ...(account ? ['-a', account] : []),
        '-w',
      ],
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        resolve(stdout.trim() || null);
      }
    );
  });
};
