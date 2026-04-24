import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface MetricBudget {
  maxExports: number;
  maxImports: number;
  maxLoc: number;
}

interface MetricConfig {
  default: MetricBudget;
  overrides: Record<string, Partial<MetricBudget>>;
}

interface ModuleMetrics {
  file: string;
  exports: number;
  imports: number;
  loc: number;
  budget: MetricBudget;
}

interface MetricViolation {
  file: string;
  metric: keyof MetricBudget;
  actual: number;
  limit: number;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const configPath = resolve(repoRoot, 'quality/module-metrics.config.json');
const reportPath = resolve(
  repoRoot,
  process.env.MODULE_METRICS_REPORT ?? 'reports/module-metrics.json'
);
const sourceRoot = resolve(repoRoot, 'src');

const config = JSON.parse(readFileSync(configPath, 'utf8')) as MetricConfig;

const walk = (dir: string): string[] => {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      return walk(entryPath);
    }

    return entryPath.endsWith('.ts') ? [entryPath] : [];
  });
};

const stripCode = (line: string, state: { inBlockComment: boolean }) => {
  let cursor = 0;
  let code = '';

  while (cursor < line.length) {
    if (state.inBlockComment) {
      const commentEnd = line.indexOf('*/', cursor);
      if (commentEnd === -1) {
        return code.trim();
      }

      state.inBlockComment = false;
      cursor = commentEnd + 2;
      continue;
    }

    const blockStart = line.indexOf('/*', cursor);
    const lineStart = line.indexOf('//', cursor);
    let nextBreak = line.length;
    let commentType: 'block' | 'line' | null = null;

    if (blockStart !== -1 && blockStart < nextBreak) {
      nextBreak = blockStart;
      commentType = 'block';
    }

    if (lineStart !== -1 && lineStart < nextBreak) {
      nextBreak = lineStart;
      commentType = 'line';
    }

    code += line.slice(cursor, nextBreak);

    if (commentType === 'block') {
      state.inBlockComment = true;
      cursor = nextBreak + 2;
      continue;
    }

    break;
  }

  return code.trim();
};

const resolveBudget = (file: string): MetricBudget => {
  const override = config.overrides[file] ?? {};

  return {
    maxExports: override.maxExports ?? config.default.maxExports,
    maxImports: override.maxImports ?? config.default.maxImports,
    maxLoc: override.maxLoc ?? config.default.maxLoc,
  };
};

const collectMetrics = (filePath: string): ModuleMetrics => {
  const state = { inBlockComment: false };
  const relativePath = relative(repoRoot, filePath).replaceAll('\\', '/');
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  let exports = 0;
  let imports = 0;
  let loc = 0;

  for (const line of lines) {
    const code = stripCode(line, state);
    if (!code) {
      continue;
    }

    loc += 1;

    if (/^import\b/.test(code)) {
      imports += 1;
    }

    if (/^export\b/.test(code)) {
      exports += 1;
    }
  }

  return {
    budget: resolveBudget(relativePath),
    exports,
    file: relativePath,
    imports,
    loc,
  };
};

const metrics = walk(sourceRoot)
  .map(collectMetrics)
  .sort((left, right) => right.loc - left.loc);

const violations: MetricViolation[] = metrics.flatMap((metric) => {
  const found: MetricViolation[] = [];

  if (metric.loc > metric.budget.maxLoc) {
    found.push({
      actual: metric.loc,
      file: metric.file,
      limit: metric.budget.maxLoc,
      metric: 'maxLoc',
    });
  }

  if (metric.imports > metric.budget.maxImports) {
    found.push({
      actual: metric.imports,
      file: metric.file,
      limit: metric.budget.maxImports,
      metric: 'maxImports',
    });
  }

  if (metric.exports > metric.budget.maxExports) {
    found.push({
      actual: metric.exports,
      file: metric.file,
      limit: metric.budget.maxExports,
      metric: 'maxExports',
    });
  }

  return found;
});

mkdirSync(dirname(reportPath), { recursive: true });

writeFileSync(
  reportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      modules: metrics,
      totals: {
        modules: metrics.length,
        sourceLoc: metrics.reduce((sum, metric) => sum + metric.loc, 0),
      },
      violations,
    },
    null,
    2
  )
);

const topModules = metrics
  .slice(0, 10)
  .map(
    (metric) =>
      `| ${metric.file} | ${metric.loc} | ${metric.imports} | ${metric.exports} |`
  )
  .join('\n');

const summary = [
  '## Module metrics',
  '',
  '| File | LOC | Imports | Exports |',
  '| --- | ---: | ---: | ---: |',
  topModules,
  '',
  `Report: \`${relative(repoRoot, reportPath).replaceAll('\\', '/')}\``,
].join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, {
    flag: 'a',
  });
}

process.stdout.write(`${summary}\n`);

if (violations.length > 0) {
  process.stderr.write('\nModule budgets exceeded:\n');

  for (const violation of violations) {
    process.stderr.write(
      `- ${violation.file}: ${violation.metric} is ${violation.actual}, limit is ${violation.limit}\n`
    );
  }

  process.exitCode = 1;
}
