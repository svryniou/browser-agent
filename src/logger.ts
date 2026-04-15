import chalk from 'chalk';

function timestamp(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `[${hh}:${mm}:${ss}]`;
}

function prefix(): string {
  return chalk.gray(timestamp()) + ' ';
}

export const logger = {
  info(msg: string): void {
    console.log(prefix() + chalk.white('●') + ' ' + msg);
  },

  step(n: number, total: number, instruction: string): void {
    console.log(
      prefix() +
        chalk.cyan(`Step ${n}/${total}:`) +
        ' ' +
        chalk.white(`"${instruction}"`)
    );
  },

  action(msg: string, success: boolean, durationMs?: number): void {
    const durationStr = durationMs !== undefined ? chalk.gray(` (${(durationMs / 1000).toFixed(1)}s)`) : '';
    const icon = success ? chalk.green('✓') : chalk.red('✗');
    console.log(prefix() + '  ' + chalk.gray('→') + ' ' + msg + ' ' + icon + durationStr);
  },

  actionIntermediate(msg: string): void {
    console.log(prefix() + '  ' + chalk.gray('→') + ' ' + msg);
  },

  retry(attempt: number, reason: string): void {
    console.log(prefix() + '  ' + chalk.yellow(`⟳ Retry ${attempt}:`) + ' ' + chalk.yellow(reason));
  },

  warn(msg: string): void {
    console.log(prefix() + chalk.yellow('⚠') + ' ' + msg);
  },

  error(msg: string): void {
    console.error(prefix() + chalk.red('✗') + ' ' + chalk.red(msg));
  },

  success(msg: string): void {
    console.log(prefix() + chalk.green('✓') + ' ' + msg);
  },

  verbose(msg: string): void {
    console.log(prefix() + chalk.gray('  [verbose] ') + chalk.gray(msg));
  },

  divider(): void {
    console.log(chalk.gray(timestamp()) + ' ' + chalk.gray('─'.repeat(46)));
  },

  summary(lines: { label: string; value: string; color?: 'red' | 'green' | 'yellow' | 'white' }[]): void {
    for (const line of lines) {
      const valueColor = line.color || 'white';
      const colorFn = chalk[valueColor] as (s: string) => string;
      console.log(
        prefix() +
          '  ' +
          chalk.gray(line.label.padEnd(10)) +
          colorFn(line.value)
      );
    }
  },
};
