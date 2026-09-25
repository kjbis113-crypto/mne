import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import Home, { Pair } from '../app/page';

test('bilingual copy never renders escaped newline markers', () => {
  const html = renderToStaticMarkup(<Home />);
  assert.doesNotMatch(html, /\\n/);
  assert.match(html, /One scent\.\nEntirely yours\./);
  assert.match(html, /Go back\.\nJust for a moment\./);
  assert.doesNotMatch(html, /offset-line/);
  assert.match(renderToStaticMarkup(<Pair en={'One\\nTwo'} ko={'하나\\n둘'} />), /One\nTwo/);
});

test('order page retains the intake while omitting the home hero', () => {
  const html = renderToStaticMarkup(<Home orderPage />);
  assert.match(html, /id="memory"/);
  assert.match(html, /id="customer-name"/);
  assert.doesNotMatch(html, /id="home"/);
});

test('type rules increase compact leading by 15% and retain Korean optical scale', async () => {
  const css = await readFile(new URL('../app/redesign.css', import.meta.url), 'utf8');
  assert.match(css, /var\(--type\)\/1\.29375/);
  assert.match(css, /calc\(var\(--type\)\*\.84\)\/1\.38/);
  assert.doesNotMatch(css, /offset-line/);
  assert.match(css, /--rule:2px/);
});
