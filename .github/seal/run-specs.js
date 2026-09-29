#!/usr/bin/env node
/*
 * Headless runner for CSSOM's own Jasmine 1.1 browser suite.
 *
 * Opens the project's unmodified spec/index.html (which loads lib/*.js through
 * src/loader.js) in headless Chrome via puppeteer-core, attaches a console
 * reporter from the runner side, prints one line per spec plus a summary, and
 * exits non-zero on any failure, on a timeout, or when 0 specs ran.
 *
 * Usage:
 *   node .github/seal/run-specs.js [--filter "CSSOM/parse"] [--extra spec/X.spec.js ...]
 *                                  [--exclude "CSSOM > parse > @mediaall {}" ...]
 *
 *   --extra    load an additional spec file (repo-relative) into the page after
 *              index.html's own specs, for specs that index.html omits.
 *   --exclude  skip a spec by its full name (suites and spec joined by " > "),
 *              for specs that fail on the pristine upstream tree. Excluded specs
 *              are listed in the log and counted separately in the summary.
 *
 * Environment:
 *   CHROME_PATH   Chrome/Chromium executable (default: google-chrome)
 *   SPEC_FILTER   same as --filter; a "/"-separated suite/spec name prefix
 *                 (e.g. "CSSOM/CSSStyleRule"). Each segment is URL-encoded and
 *                 passed as ?spec=... to HtmlReporter.specFilter. Empty = all.
 *   SPEC_TIMEOUT  seconds to wait for the run to finish (default: 120)
 *
 * This file lives outside lib/ and is not part of the published package.
 */
'use strict';

var path = require('path');
var fs = require('fs');
var url = require('url');
var puppeteer = require('puppeteer-core');

var args = process.argv.slice(2);
var filter = process.env.SPEC_FILTER || '';
var extras = [];
var excludes = [];
for (var i = 0; i < args.length; i++) {
  if (args[i] === '--filter') {
    filter = args[++i] || '';
  } else if (args[i] === '--exclude') {
    excludes.push(args[++i]);
  } else if (args[i] === '--extra') {
    extras.push(args[++i]);
  } else {
    console.error('Unknown argument: ' + args[i]);
    process.exit(2);
  }
}

var root = path.resolve(__dirname, '..', '..');
var indexPath = path.join(root, 'spec', 'index.html');
var required = [
  'spec/vendor/jasmine/jasmine.js',
  'spec/vendor/objectDiff/objectDiff.js',
  'spec/vendor/objectDiff/jasmine-objectDiff.js',
  'spec/vendor/jasmine-html-reporter/HtmlReporter.js',
  'src/loader.js'
];
required.forEach(function (rel) {
  if (!fs.existsSync(path.join(root, rel))) {
    console.error('Missing harness file: ' + rel + ' (are the spec/vendor submodules fetched?)');
    process.exit(2);
  }
});

// Extra spec files are given relative to the repo root; the page resolves
// script URLs relative to spec/index.html.
var extraSrcs = extras.map(function (rel) {
  var abs = path.resolve(root, rel);
  if (!fs.existsSync(abs)) {
    console.error('Missing extra spec file: ' + rel);
    process.exit(2);
  }
  return path.relative(path.dirname(indexPath), abs).split(path.sep).join('/');
});

var pageUrl = url.pathToFileURL(indexPath).href;
if (filter) {
  pageUrl += '?spec=' + filter.split('/').map(encodeURIComponent).join('/');
}
var timeoutMs = (parseInt(process.env.SPEC_TIMEOUT, 10) || 120) * 1000;

// puppeteer-core needs an absolute executable path; resolve bare names on PATH.
function resolveExecutable(name) {
  if (path.isAbsolute(name)) {
    return name;
  }
  var dirs = (process.env.PATH || '').split(path.delimiter);
  for (var d = 0; d < dirs.length; d++) {
    var candidate = path.join(dirs[d], name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  console.error('Browser executable not found on PATH: ' + name);
  process.exit(2);
}
var chromePath = resolveExecutable(process.env.CHROME_PATH || 'google-chrome');

// Runs in the page before any of its scripts. At DOMContentLoaded every
// synchronous <script> in index.html has run (jasmine + all specs are
// registered) but window.onload -> jasmineEnv.execute() has not fired yet,
// because loader.js' dynamically inserted lib/ scripts still delay "load".
function pageHook(extraSrcs, excludes) {
  document.addEventListener('DOMContentLoaded', function () {
    extraSrcs.forEach(function (src) {
      var s = document.createElement('script');
      s.async = false;
      s.src = src;
      document.head.appendChild(s);
    });
    if (!window.jasmine || !jasmine.getEnv) {
      window.__sealReport({ type: 'error', message: 'jasmine is not defined on the page' });
      return;
    }
    function fullName(spec) {
      var parts = [spec.description];
      var suite = spec.suite;
      while (suite) {
        parts.unshift(suite.description);
        suite = suite.parentSuite;
      }
      return parts.join(' > ');
    }
    var env = jasmine.getEnv();
    // index.html has already installed HtmlReporter.specFilter (?spec=...);
    // wrap it so excluded specs are skipped as well.
    var pageFilter = env.specFilter;
    env.specFilter = function (spec) {
      if (excludes.indexOf(fullName(spec)) !== -1) {
        return false;
      }
      return pageFilter.call(this, spec);
    };
    env.addReporter({
      reportRunnerStarting: function () {},
      reportSpecStarting: function () {},
      reportSuiteResults: function () {},
      log: function () {},
      reportSpecResults: function (spec) {
        var r = spec.results();
        var messages = [];
        if (!r.skipped && !r.passed()) {
          r.getItems().forEach(function (item) {
            if (item.passed && !item.passed()) {
              var m = String(item.message || item);
              if (item.trace && item.trace.stack) {
                m += '\n' + item.trace.stack;
              }
              messages.push(m);
            }
          });
        }
        var name = fullName(spec);
        window.__sealReport({
          type: 'spec',
          name: name,
          excluded: excludes.indexOf(name) !== -1,
          status: r.skipped ? 'skipped' : (r.passed() ? 'passed' : 'failed'),
          messages: messages
        });
      },
      reportRunnerResults: function () {
        window.__sealReport({ type: 'done' });
      }
    });
  });
}

// Spec names are often raw CSS text; keep each result on one log line.
function display(name) {
  return name.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

(async function main() {
  var browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  var counts = { passed: 0, failed: 0, skipped: 0, excluded: 0 };
  var excludedSeen = [];
  var failures = [];
  var pageErrors = [];
  var finished;
  var done = new Promise(function (resolve, reject) {
    finished = { resolve: resolve, reject: reject };
  });
  try {
    var page = await browser.newPage();
    page.on('pageerror', function (err) {
      pageErrors.push(String(err && err.message || err));
      console.log('[page error] ' + (err && err.message || err));
    });
    page.on('requestfailed', function (req) {
      console.log('[request failed] ' + req.url() + ' ' + (req.failure() && req.failure().errorText));
    });
    await page.exposeFunction('__sealReport', function (msg) {
      if (msg.type === 'spec') {
        if (msg.excluded) {
          counts.excluded++;
          excludedSeen.push(msg.name);
          console.log('EXCL  ' + display(msg.name));
          return;
        }
        counts[msg.status]++;
        if (msg.status === 'skipped') {
          return;
        }
        console.log((msg.status === 'passed' ? 'PASS  ' : 'FAIL  ') + display(msg.name));
        if (msg.status === 'failed') {
          failures.push(msg.name);
          msg.messages.forEach(function (m) {
            console.log('      ' + m.split('\n').join('\n      '));
          });
        }
      } else if (msg.type === 'done') {
        finished.resolve();
      } else if (msg.type === 'error') {
        finished.reject(new Error(msg.message));
      }
    });
    await page.evaluateOnNewDocument(pageHook, extraSrcs, excludes);

    console.log('Opening ' + pageUrl);
    if (extraSrcs.length) {
      console.log('Extra spec files: ' + extraSrcs.join(', '));
    }
    excludes.forEach(function (n) { console.log('Excluding spec: ' + n); });
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        reject(new Error('Timed out after ' + timeoutMs / 1000 + 's waiting for Jasmine to finish'));
      }, timeoutMs);
    });
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await Promise.race([done, timeout]);
    clearTimeout(timer);
  } finally {
    await browser.close();
  }

  var ran = counts.passed + counts.failed;
  console.log('');
  console.log('Specs: ' + ran + ' run, ' + counts.passed + ' passed, ' + counts.failed +
    ' failed, ' + counts.skipped + ' skipped (filtered out), ' + counts.excluded + ' excluded');
  var unmatched = excludes.filter(function (n) { return excludedSeen.indexOf(n) === -1; });
  if (unmatched.length && !filter) {
    console.error('ERROR: --exclude names matched no spec: ' + unmatched.join(' | '));
    process.exit(1);
  }
  if (failures.length) {
    console.log('Failed specs:');
    failures.forEach(function (n) { console.log('  - ' + display(n)); });
  }
  if (pageErrors.length) {
    console.log('Page errors: ' + pageErrors.length);
  }
  if (ran === 0) {
    console.error('ERROR: 0 specs ran' + (filter ? ' (filter "' + filter + '" matched nothing)' : ''));
    process.exit(1);
  }
  if (counts.failed > 0 || pageErrors.length > 0) {
    process.exit(1);
  }
})().catch(function (err) {
  console.error('ERROR: ' + (err && err.stack || err));
  process.exit(1);
});
