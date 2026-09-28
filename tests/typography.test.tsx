import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import Home, { Pair } from '../app/page';
import { printFrame } from '../app/architectural-background';

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

test('supplied background prints keep their sequence and fade with scroll', () => {
  const html = renderToStaticMarkup(<Home />);
  assert.ok(html.indexOf('/architecture-01.png') < html.indexOf('/architecture-02.png'));
  assert.ok(html.indexOf('/architecture-02.png') < html.indexOf('/architecture-03.png'));
  assert.ok(printFrame(.7, 0).blur > printFrame(0, 0).blur);
  assert.ok(printFrame(.7, 0).opacity < printFrame(0, 0).opacity);
  assert.equal(printFrame(1.2, 0).opacity, 0);
  assert.equal(printFrame(.7, 0, true).blur, 0);
});

test('mobile arrows are SVG paths, not font or emoji glyphs', () => {
  const html = renderToStaticMarkup(<Home />);
  assert.doesNotMatch(html, /[↗↑↓→]/);
  assert.match(html, /class="ui-arrow"/);
});

test('intake offers image upload without a duplicate URL field', () => {
  const html = renderToStaticMarkup(<Home orderPage />);
  assert.match(html, /type="file"/);
  assert.doesNotMatch(html, /id="photo-link"|Existing photo link|기존 사진 링크/);
});
