// After each update (the GitHub workflow): the data check's errors and warnings (public/audit.json,
// src/audit.js) as one open issue labeled "data check", so the maintainer is emailed when something
// goes wrong instead of finding it on the map. New problems are added as a comment (GitHub emails
// those); the issue's text is kept current; once everything passes, it's closed.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { auditMarkdown } from '../src/audit.js';

const LABEL = 'data check';
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const audit = JSON.parse(await readFile(new URL('../public/audit.json', import.meta.url), 'utf8'));
const problems = audit.findings.filter((f) => f.level !== 'info');
const key = (f) => `${f.area}|${f.resort ?? ''}|${f.check}`;
const keys = [...new Set(problems.map(key))].sort();

const open = JSON.parse(gh('issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number,body', '--limit', '1'))[0];
if (!problems.length) {
  if (open) {
    gh('issue', 'comment', String(open.number), '--body', `All checks pass as of ${audit.at}.`);
    gh('issue', 'close', String(open.number));
    console.log(`Closed #${open.number}: all checks pass.`);
  } else console.log('All checks pass.');
} else {
  const body = `${auditMarkdown(audit.findings, audit.at)}\n\n<!-- keys: ${keys.join(';')} -->\n_Updated each run; closes itself once everything passes. Details: public/audit.json on the site._`;
  if (!open) {
    gh('label', 'create', LABEL, '--color', 'D93F0B', '--description', 'Powdar data check: errors and warnings from the latest update', '--force');
    const url = gh('issue', 'create', '--title', `Data check: ${audit.errors} errors, ${audit.warnings} warnings`, '--label', LABEL, '--body', body);
    console.log(`Opened ${url}`);
  } else {
    const before = /<!-- keys: (.*?) -->/.exec(open.body ?? '')?.[1]?.split(';').filter(Boolean) ?? [];
    const fresh = problems.filter((f) => !before.includes(key(f)));
    gh('issue', 'edit', String(open.number), '--title', `Data check: ${audit.errors} errors, ${audit.warnings} warnings`, '--body', body);
    if (fresh.length) gh('issue', 'comment', String(open.number), '--body', `New since the last check:\n${fresh.map((f) => `- ${f.area} · ${f.resort ?? ''} · ${f.check}: ${f.msg}`).join('\n')}`);
    console.log(`Updated #${open.number}${fresh.length ? ` (${fresh.length} new)` : ''}.`);
  }
}
