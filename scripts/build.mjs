import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const ALIASES = [
  ['@components/', 'components/'],
  ['@configs/', 'configs/'],
  ['@core/', 'core/'],
  ['@features/', 'features/'],
  ['@interfaces/', 'interfaces/'],
  ['@lib/', 'lib/'],
  ['@services/', 'services/'],
  ['@utils/', 'utils/'],
];

function toPosix(value) {
  return value.split(path.sep).join('/');
}

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }

  return files;
}

function rewriteAliases(sourceText, filePath) {
  const fileDir = path.dirname(filePath);

  return sourceText.replace(/from\s+['"]([^'"]+)['"]/g, (match, specifier) => {
    const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix));
    if (!alias) {
      return match;
    }

    const [prefix, sourceDir] = alias;
    const aliasTarget = specifier.slice(prefix.length);
    const sourceTarget = path.join(SRC_DIR, sourceDir, aliasTarget);
    const distTarget = path.join(DIST_DIR, path.relative(SRC_DIR, sourceTarget)).replace(/\.(tsx?|jsx?)$/, '.js');
    const relative = path.relative(fileDir, distTarget);
    const normalized = toPosix(relative.startsWith('.') ? relative : `./${relative}`);
    return `from '${normalized}'`;
  });
}

function appendJsExtensions(sourceText) {
  return sourceText.replace(/from\s+(['"])(\.(?:\.|\/)[^'"]+)\1/g, (match, quote, specifier) => {
    if (specifier.endsWith('.js')) {
      return match;
    }

    return `from ${quote}${specifier}.js${quote}`;
  });
}

async function buildFile(filePath) {
  const relativePath = path.relative(SRC_DIR, filePath);
  const outputPath = path.join(DIST_DIR, relativePath).replace(/\.(tsx?)$/, '.js');
  const sourceText = await fs.readFile(filePath, 'utf8');
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      sourceMap: false,
    },
    fileName: filePath,
  });

  const rewritten = appendJsExtensions(rewriteAliases(transpiled.outputText, outputPath));

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, rewritten, 'utf8');
}

async function main() {
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  const files = await walkFiles(SRC_DIR);

  for (const filePath of files) {
    await buildFile(filePath);
  }

  console.log(`Built ${files.length} files into dist/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
