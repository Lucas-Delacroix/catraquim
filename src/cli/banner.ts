import packageJson from '../../package.json' with { type: 'json' };

import { bold, cyan, dim, orange } from './colors.js';

const TATU =
  '                                   #@@@+                                    \n' +
  '                            @@@##@@@@@ @@@@*@@                              \n' +
  '                         #=@@@ @@@@@ @@@@ @@@ @@@      @@.                  \n' +
  '                       @*@@@% @@@@: @@@@@ @%.@=*=     @@@*                  \n' +
  '                      @@:@@@ @@@@.#@@@@@@ @@@ @ @@@@@* *@                   \n' +
  '                     @@ @@@ @@@@@ @@@@@@@@ @@ @@ @@@@@@@                    \n' +
  '                    @@@ @@@ @@@@ @@@@@@@@@@  @@@@@ @@@@@@                   \n' +
  '                    @@ *@@  @@@@ @@@@@@@@@ @@@@@@@@@ @@@@@                  \n' +
  '                   @@@.+@@  @@@@ @@@@@@@@@ @@@@@#  @@ *@@@                  \n' +
  '                    @@+ @@. @@@@ @@@@@@@@@@ @@@@.   @@@ @@@                 \n' +
  '                  :@    @@@ @@@@ @@@@@@@@@ = @@@@@@@@@@@@@@                 \n' +
  '                 @#@@ #*    @@@@% @@@@@  @@@@@= =@@@@@@@@@@@#               \n' +
  '              @@@@@@  %@@@@@=        %@@@@@@@@       :@@@@@:                \n' +
  '            @@@@@      @@@@-  %@%   @@@@@      %@                           \n' +
  '                        *# @=@ *@@   *%@@@.     @@@@                        \n' +
  '                                        @@@%                                \n';

export const printBanner = (): void => {
  process.stdout.write(`\n${orange(TATU)}`);
  process.stdout.write(
    `  ${bold(cyan('catraquim'))} ${dim(`v${packageJson.version}`)}  ${dim('·')}  ${dim('Local LLM gateway')}\n\n`
  );
};
