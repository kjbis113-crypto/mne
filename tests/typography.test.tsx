import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import Home, { Pair } from '../app/page';
import { printFrame } from '../app/architectural-background';

test('Korean copy never renders English pairs or escaped newline markers', () => {
  const html = renderToStaticMarkup(<Home />);
  assert.doesNotMatch(html, /\\n/);
  assert.match(html, /오롯이\n당신만의 향\./);
  assert.match(html, /어떤 순간을\n간직하고 싶나요\?/);
  assert.doesNotMatch(html, /lang="en"/);
  assert.doesNotMatch(html, /offset-line/);
  assert.match(renderToStaticMarkup(<Pair en={'One\\nTwo'} ko={'하나\\n둘'} />), /하나\n둘/);
});

test('order page retains the intake while omitting the home hero', () => {
  const html = renderToStaticMarkup(<Home orderPage />);
  assert.match(html, /id="memory"/);
  assert.match(html, /id="customer-name"/);
  assert.doesNotMatch(html, /id="home"/);
});

test('editorial type uses a single Korean scale and hosted font', async () => {
  const css = await readFile(new URL('../app/editorial.css', import.meta.url), 'utf8');
  assert.match(css, /var\(--type\)\/1\.6/);
  assert.match(css, /PretendardVariable\.woff2/);
  assert.doesNotMatch(css, /var\(--type\)\*\.84/);
  assert.doesNotMatch(css, /offset-line/);
  assert.match(css, /--rule:2px/);
});

test('home has Korean titles without decorative labels or empty analysis placeholders', () => {
  const html = renderToStaticMarkup(<Home />);
  assert.match(html, /<h1><span class="pair /);
  assert.match(html, /class="process-overview"/);
  assert.match(html, /<details class="process-details"/);
  assert.doesNotMatch(html, /Three MSE candidate slots/);
  assert.doesNotMatch(html, /THE IDEA|기억으로부터 시작되는 향|intro-label|hero-image-meta|field-number|compass-note-index|note-number|process-index/);
  assert.match(html, /id="scent"/);
  assert.match(html, /id="archive"/);
});

test('public page metadata is Korean', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="ko">/);
  assert.match(html, /<title>MNÉ — 기억으로 태어난 향<\/title>/);
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
