#!/usr/bin/env node
/**
 * mini-archify — 最简工作流图生成器
 * 用法: node mini-archify.mjs <candidate.json> [输出.html]
 *
 * 依赖: Archify 已安装在 ~/.agents/skills/archify/
 *       Node.js >=18
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const ARCHIFY = resolve(homedir(), '.agents/skills/archify');

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error('用法: node mini-archify.mjs <candidate.json> [输出.html]');
  process.exit(1);
}

const inputPath = resolve(input);
const outputPath = output ? resolve(output) : inputPath.replace(/\.json$/i, '.html');

const result = spawnSync(
  process.execPath,
  [
    resolve(ARCHIFY, 'bin/archify.mjs'),
    'finalize', 'workflow', inputPath, outputPath,
    '--quality', 'showcase', '--json',
  ],
  { cwd: ARCHIFY, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true }
);

const receipt = JSON.parse(result.stdout || '{}');
if (receipt.ok) {
  console.log('✅ 图已生成:', outputPath);
} else {
  console.error('❌ 失败:', receipt.failedStage);
  for (const d of receipt.diagnostics || []) {
    console.error('  -', d.message);
  }
  process.exit(1);
}