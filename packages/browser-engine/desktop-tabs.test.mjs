import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopTabs} from './desktop-control.mjs';

test('desktop page scope ignores a new tab before its HTTP navigation starts',()=>{
  const tabs=new DesktopTabs({}, {allowedUrls:['https://notebooks.example.com/code/test-account/sample-notebook']});
  assert.equal(tabs.allows(''),false);
  assert.equal(tabs.allows('about:blank'),false);
  assert.equal(tabs.allows('file:///shell.html'),false);
  assert.equal(tabs.allows('https://notebooks.example.com/code/test-account/sample-notebook?version=3'),true);
  assert.equal(tabs.allows('https://notebooks.example.com/code/another/notebook'),false);
});

test('desktop page scope supports subpaths and wildcard suffixes while keeping root exact',()=>{
  const tabs=new DesktopTabs({}, {allowedUrls:[
    'https://console.cloud.tencent.com/cdn',
    'https://example.com/',
    'https://wild.example.com/app/*',
    'https://all.example.com/*'
  ]});
  assert.equal(tabs.allows('https://console.cloud.tencent.com/cdn'),true);
  assert.equal(tabs.allows('https://console.cloud.tencent.com/cdn/certificate'),true);
  assert.equal(tabs.allows('https://console.cloud.tencent.com/cdn/certificate/edit/example-id'),true);
  assert.equal(tabs.allows('https://console.cloud.tencent.com/cdn2'),false);
  assert.equal(tabs.allows('https://console.cloud.tencent.com/ssl'),false);
  assert.equal(tabs.allows('https://example.com/'),true);
  assert.equal(tabs.allows('https://example.com/?tab=1'),true);
  assert.equal(tabs.allows('https://example.com/other'),false);
  assert.equal(tabs.allows('https://wild.example.com/app'),true);
  assert.equal(tabs.allows('https://wild.example.com/app/sub/1'),true);
  assert.equal(tabs.allows('https://wild.example.com/app2'),false);
  assert.equal(tabs.allows('https://all.example.com/'),true);
  assert.equal(tabs.allows('https://all.example.com/a/b/c'),true);
});
