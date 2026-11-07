const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '../upstream/firefox');
let year = 2026;
const footer = {textContent: ''};
let tick;
let resume;
vm.runInNewContext(fs.readFileSync(path.join(root, 'business-footer.js'), 'utf8'), {
  Date: class { getFullYear() { return year; } },
  document: {
    querySelectorAll: () => [footer],
    addEventListener: (event, fn) => { assert.equal(event, 'visibilitychange'); resume = fn; }
  },
  setInterval: (fn, delay) => { assert.equal(delay, 1000); tick = fn; }
});
const expected = y => `© ${y} SERVER TAMER DI DANIELE VANTAGGIATO - P.IVA 04370600274`;
assert.equal(footer.textContent, expected(2026));
year = 2027; tick();
assert.equal(footer.textContent, expected(2027));
year = 2028; resume();
assert.equal(footer.textContent, expected(2028));
for (const page of ['dashboard.html', 'popup.html']) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  assert.match(html, /<script src="business-footer.js" defer><\/script>/);
  assert.match(html, /data-business-footer/);
}
console.log('PASS exact VAT and format; open-page year rollover; suspended-page resume; both pages wired');
