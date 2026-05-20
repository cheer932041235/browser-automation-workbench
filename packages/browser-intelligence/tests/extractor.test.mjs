import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Set BI_LOGS_DIR before importing extractor
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-extract-test-'));
process.env.BI_LOGS_DIR = tmpDir;

const {
  extractContent,
  detectPlatform,
  parseXhsText,
  parseXhsNetwork,
  parseGenericText,
  extractXhsNoteId,
  scorePost,
  parseEngagementNumber,
  collectUrls,
  categorizePost,
  detectTimeliness,
  scoreHangzhouRelevance,
  isXhsFeedPage,
  parseXhsFeedText,
} = await import('../scripts/lib/extractor.mjs');

process.on('exit', () => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

describe('detectPlatform', () => {
  test('detects xiaohongshu from URL', () => {
    const p = detectPlatform(['https://www.xiaohongshu.com/explore/abc123']);
    assert.equal(p.name, 'xiaohongshu');
  });

  test('detects xhslink short URL', () => {
    const p = detectPlatform(['https://xhslink.com/abc']);
    assert.equal(p.name, 'xiaohongshu');
  });

  test('falls back to generic for unknown sites', () => {
    const p = detectPlatform(['https://example.com']);
    assert.equal(p.name, 'generic');
  });
});

// ---------------------------------------------------------------------------
// XHS note ID extraction
// ---------------------------------------------------------------------------

describe('extractXhsNoteId', () => {
  test('extracts from /explore/ URL', () => {
    assert.equal(extractXhsNoteId('https://www.xiaohongshu.com/explore/6645a1b2c3d4e5f6a7b8c9d0'), '6645a1b2c3d4e5f6a7b8c9d0');
  });

  test('extracts from /discovery/item/ URL', () => {
    assert.equal(extractXhsNoteId('https://www.xiaohongshu.com/discovery/item/6645a1b2c3d4e5f6a7b8c9d0'), '6645a1b2c3d4e5f6a7b8c9d0');
  });

  test('returns empty for non-note URL', () => {
    assert.equal(extractXhsNoteId('https://www.xiaohongshu.com/user/profile/abc'), '');
  });
});

// ---------------------------------------------------------------------------
// Engagement number parsing
// ---------------------------------------------------------------------------

describe('parseEngagementNumber', () => {
  test('parses plain numbers', () => {
    assert.equal(parseEngagementNumber('1234'), 1234);
  });

  test('parses numbers with commas', () => {
    assert.equal(parseEngagementNumber('1,234'), 1234);
  });

  test('returns null for empty string', () => {
    assert.equal(parseEngagementNumber(''), null);
  });
});

// ---------------------------------------------------------------------------
// XHS text parser
// ---------------------------------------------------------------------------

describe('parseXhsText', () => {
  const SAMPLE_XHS_TEXT = `小薯小助手
杭州周末好去处｜2026年5月免费展览合集
周末不知道去哪？这份杭州5月免费展览清单请收好！

1. 浙江省博物馆 - 宋韵文化特展
地点：浙江省博物馆之江馆区
时间：即日起至6月30日
亮点：200+件宋代文物首次展出

2. 中国美术学院 - 毕业设计展
地点：南山校区美术馆
时间：5月20日-6月5日

#杭州周末# #杭州展览# #免费展览#

这些展览都很值得一看，记得提前预约哦～

320赞 156收藏 28评论
2026-05-18`;

  test('extracts tags from XHS text', () => {
    const post = parseXhsText(SAMPLE_XHS_TEXT, { url: 'https://www.xiaohongshu.com/explore/6645a1b2c3d4e5f6a7b8c9d0' });
    assert.ok(post);
    assert.ok(post.tags.includes('杭州周末'));
    assert.ok(post.tags.includes('杭州展览'));
    assert.ok(post.tags.includes('免费展览'));
  });

  test('extracts engagement metrics', () => {
    const post = parseXhsText(SAMPLE_XHS_TEXT, {});
    assert.equal(post.engagement.likes, 320);
    assert.equal(post.engagement.saves, 156);
    assert.equal(post.engagement.comments, 28);
  });

  test('extracts publish time', () => {
    const post = parseXhsText(SAMPLE_XHS_TEXT, {});
    assert.ok(post.publishTime.includes('2026-05-18'));
  });

  test('extracts noteId from URL', () => {
    const post = parseXhsText(SAMPLE_XHS_TEXT, { url: 'https://www.xiaohongshu.com/explore/6645a1b2c3d4e5f6a7b8c9d0' });
    assert.equal(post.noteId, '6645a1b2c3d4e5f6a7b8c9d0');
  });

  test('extracts title as first content line', () => {
    const post = parseXhsText(SAMPLE_XHS_TEXT, {});
    assert.ok(post.title.length > 0, `Expected non-empty title, got: "${post.title}"`);
  });

  test('extracts body', () => {
    const post = parseXhsText(SAMPLE_XHS_TEXT, {});
    assert.ok(post.body.length > 50);
  });

  test('returns null for very short text', () => {
    assert.equal(parseXhsText('hi', {}), null);
  });

  test('handles text without engagement data', () => {
    const post = parseXhsText('这是一段测试文本\n没有互动数据\n但是够长', {});
    assert.ok(post);
    assert.equal(post.engagement.likes, null);
  });
});

// ---------------------------------------------------------------------------
// XHS network parser
// ---------------------------------------------------------------------------

describe('parseXhsNetwork', () => {
  test('identifies XHS API endpoints', () => {
    const requests = [
      { url: 'https://edith.xiaohongshu.com/api/sns/web/v1/feed', method: 'POST', status: 200, mimeType: 'application/json' },
      { url: 'https://edith.xiaohongshu.com/api/sns/web/v1/note/abc', method: 'GET', status: 200, mimeType: 'application/json' },
      { url: 'https://www.xiaohongshu.com/style.css', method: 'GET', status: 200, mimeType: 'text/css' },
    ];
    const apis = parseXhsNetwork(requests);
    assert.equal(apis.length, 2);
    assert.equal(apis[0].classification, 'xhs_api');
  });

  test('returns empty for non-API requests', () => {
    const requests = [
      { url: 'https://www.xiaohongshu.com/page', method: 'GET', status: 200, mimeType: 'text/html' },
    ];
    assert.equal(parseXhsNetwork(requests).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Quality scoring
// ---------------------------------------------------------------------------

describe('scorePost', () => {
  test('scores a complete post highly', () => {
    const post = {
      title: '杭州展览推荐',
      body: '这是一篇关于杭州展览的推荐文章，内容很丰富很详细，周末去打卡吧，强烈推荐每个人都去看看这些展览',
      author: '小助手',
      tags: ['杭州', '展览'],
      publishTime: '2026-05-18',
      engagement: { likes: 100, saves: 50, comments: 10 },
      noteId: 'abc123def456abc123def456',
    };
    const score = scorePost(post);
    assert.ok(score >= 8, `Expected score >= 8, got ${score}`);
  });

  test('scores an empty post low', () => {
    const post = {
      title: '',
      body: '',
      author: '',
      tags: [],
      publishTime: '',
      engagement: { likes: null, saves: null, comments: null },
      noteId: '',
    };
    assert.equal(scorePost(post), 0);
  });
});

// ---------------------------------------------------------------------------
// collectUrls
// ---------------------------------------------------------------------------

describe('collectUrls', () => {
  test('collects URLs from trace and pages', () => {
    const trace = [
      { type: 'start', url: 'https://a.com' },
      { type: 'stop', finalUrl: 'https://b.com' },
    ];
    const pages = {
      final: { info: { url: 'https://c.com' } },
      navigation: [{ url: 'https://d.com' }],
    };
    const urls = collectUrls(trace, pages);
    assert.ok(urls.includes('https://a.com'));
    assert.ok(urls.includes('https://b.com'));
    assert.ok(urls.includes('https://c.com'));
    assert.ok(urls.includes('https://d.com'));
  });
});

// ---------------------------------------------------------------------------
// Content categorization
// ---------------------------------------------------------------------------

describe('categorizePost', () => {
  test('categorizes exhibition post', () => {
    const post = { title: '杭州美术馆新展览', body: '当代艺术展开展了', tags: ['展览'] };
    const cat = categorizePost(post);
    assert.equal(cat.primary.name, 'exhibition');
    assert.ok(cat.all.length >= 1);
  });

  test('categorizes food post', () => {
    const post = { title: '探店', body: '这家咖啡店太好吃了，拔草推荐', tags: ['美食'] };
    const cat = categorizePost(post);
    assert.equal(cat.primary.name, 'food');
  });

  test('returns uncategorized for unmatched content', () => {
    const post = { title: '今天天气真好', body: '没什么特别的', tags: [] };
    const cat = categorizePost(post);
    assert.equal(cat.primary.name, 'uncategorized');
  });

  test('multi-category with priority by hits', () => {
    const post = { title: '杭州周末活动', body: '市集+展览+音乐节开幕报名', tags: ['活动'] };
    const cat = categorizePost(post);
    assert.ok(cat.all.length >= 2, 'Should match multiple categories');
    assert.equal(cat.primary.name, 'event'); // most keyword hits
  });
});

// ---------------------------------------------------------------------------
// Timeliness detection
// ---------------------------------------------------------------------------

describe('detectTimeliness', () => {
  test('detects deadline urgency', () => {
    const post = { title: '报名截止明天', body: '最后一天了', publishTime: '' };
    const tl = detectTimeliness(post);
    assert.equal(tl.urgency, 'high');
    assert.ok(tl.isTimeSensitive);
  });

  test('detects date range as medium urgency', () => {
    const post = { title: '展览', body: '5月20日至6月5日', publishTime: '' };
    const tl = detectTimeliness(post);
    assert.equal(tl.urgency, 'medium');
  });

  test('detects “即日起至” as medium urgency', () => {
    const post = { title: '展览', body: '即日起至2026-06-30', publishTime: '' };
    const tl = detectTimeliness(post);
    assert.equal(tl.urgency, 'medium');
  });

  test('detects relative dates', () => {
    const post = { title: '本周六活动', body: '下周日截止', publishTime: '' };
    const tl = detectTimeliness(post);
    assert.ok(tl.isTimeSensitive);
    assert.ok(tl.signals.length >= 1);
  });

  test('returns none for no time signals', () => {
    const post = { title: '日常分享', body: '这是一个没有时间标记的帖子', publishTime: '' };
    const tl = detectTimeliness(post);
    assert.equal(tl.urgency, 'none');
    assert.equal(tl.isTimeSensitive, false);
  });
});

// ---------------------------------------------------------------------------
// Hangzhou relevance
// ---------------------------------------------------------------------------

describe('scoreHangzhouRelevance', () => {
  test('scores Hangzhou-related post', () => {
    const post = { title: '杭州西湖边的展览', body: '浙江美术馆很值得去', tags: ['杭州'] };
    const rel = scoreHangzhouRelevance(post);
    assert.ok(rel.isRelevant);
    assert.ok(rel.score >= 3); // 杭州(2) + 西湖(1) + 浙江美术馆(1)
    assert.ok(rel.matched.includes('杭州'));
    assert.ok(rel.matched.includes('西湖'));
  });

  test('scores zero for non-Hangzhou post', () => {
    const post = { title: '上海探店', body: '外滩附近新开的咖啡店', tags: ['上海'] };
    const rel = scoreHangzhouRelevance(post);
    assert.equal(rel.isRelevant, false);
    assert.equal(rel.score, 0);
  });

  test('gives 杭州 keyword extra weight', () => {
    const post = { title: '杭州', body: '', tags: [] };
    const rel = scoreHangzhouRelevance(post);
    assert.equal(rel.score, 2); // 杭州 = 2 points
  });
});

// ---------------------------------------------------------------------------
// Multi-post extraction (feed/search pages)
// ---------------------------------------------------------------------------

describe('isXhsFeedPage', () => {
  test('detects search result page', () => {
    assert.ok(isXhsFeedPage({ url: 'https://www.xiaohongshu.com/search_result?keyword=杭州展览' }, ''));
  });

  test('detects explore page', () => {
    assert.ok(isXhsFeedPage({ url: 'https://www.xiaohongshu.com/explore' }, ''));
    assert.ok(isXhsFeedPage({ url: 'https://www.xiaohongshu.com/explore?channel=travel' }, ''));
  });

  test('detects home page', () => {
    assert.ok(isXhsFeedPage({ url: 'https://www.xiaohongshu.com/' }, ''));
  });

  test('detects feed by multiple engagement patterns in text', () => {
    const text = '帖子A 123赞\n帖子B 456赞\n帖子C 789赞';
    assert.ok(isXhsFeedPage({ url: 'https://www.xiaohongshu.com/something' }, text));
  });

  test('returns false for single post page', () => {
    assert.equal(isXhsFeedPage(
      { url: 'https://www.xiaohongshu.com/explore/6645a1b2c3d4e5f6a7b8c9d0' },
      '单篇帖子内容 42赞'
    ), false);
  });
});

describe('parseXhsFeedText', () => {
  test('splits feed text into multiple posts by engagement', () => {
    const feedText = `@展览达人
杭州浙江美术馆新展开幕
#杭州展览#
256赞
@美食小王子
滨江探店新发现！这家咖啡店太绝了
#杭州美食# #探店#
189赞
@活动组织者
本周六西溪湿地市集，报名截止周三
#杭州活动#
92赞`;

    const posts = parseXhsFeedText(feedText, { url: 'https://www.xiaohongshu.com/explore' });
    assert.ok(posts.length >= 3, `Expected 3+ posts, got ${posts.length}`);

    // Check first post
    assert.ok(posts[0].title.includes('浙江美术馆') || posts[0].title.includes('杭州'));
    assert.equal(posts[0].engagement.likes, 256);
    assert.equal(posts[0].source, 'feed_card');

    // Check second post
    assert.equal(posts[1].engagement.likes, 189);
    assert.ok(posts[1].tags.includes('杭州美食'));

    // Check third post
    assert.equal(posts[2].engagement.likes, 92);
  });

  test('returns empty for very short text', () => {
    const posts = parseXhsFeedText('short', {});
    assert.equal(posts.length, 0);
  });

  test('falls back to author-split when no engagement delimiters', () => {
    const feedText = `@用户A
这是第一篇帖子的标题
帖子内容在这里
@用户B
这是第二篇帖子的标题
另一篇的内容`;
    const posts = parseXhsFeedText(feedText, { url: 'https://www.xiaohongshu.com/explore' });
    assert.ok(posts.length >= 2, `Expected 2+ posts via author split, got ${posts.length}`);
  });
});

// ---------------------------------------------------------------------------
// Integration: extractContent
// ---------------------------------------------------------------------------

describe('extractContent integration', () => {
  test('extracts content from a synthetic XHS trace', () => {
    const tracesDir = path.join(tmpDir, 'traces');
    fs.mkdirSync(tracesDir, { recursive: true });
    const taskDir = path.join(tracesDir, 'xhs-test-01');
    fs.mkdirSync(taskDir, { recursive: true });

    // Synthetic XHS trace
    const traceLines = [
      JSON.stringify({ time: '2026-05-19T10:00:00.000Z', type: 'start', url: 'https://www.xiaohongshu.com/explore/6645a1b2c3d4e5f6a7b8c9d0' }),
      JSON.stringify({ time: '2026-05-19T10:00:05.000Z', type: 'mark', note: '浏览帖子页面' }),
      JSON.stringify({ time: '2026-05-19T10:00:30.000Z', type: 'stop', finalUrl: 'https://www.xiaohongshu.com/explore/6645a1b2c3d4e5f6a7b8c9d0', finalTitle: '杭州展览推荐' }),
    ];
    fs.writeFileSync(path.join(taskDir, 'trace.jsonl'), traceLines.join('\n') + '\n');

    // Synthetic XHS page text
    const xhsPageText = `展览达人小薯
杭州本周必看展览TOP5
五月杭州展览太多了！精选5个最值得去的：

1. 浙江美术馆 - 当代艺术双年展
免费 | 截止6月底

2. 良渚博物院 - 5000年文明展
免费 | 常设展

#杭州展览# #周末去哪玩# #免费展览#

425赞 268收藏 32评论
2026-05-17`;

    fs.writeFileSync(path.join(taskDir, 'pages.json'), JSON.stringify({
      final: {
        info: { title: '杭州展览推荐', url: 'https://www.xiaohongshu.com/explore/6645a1b2c3d4e5f6a7b8c9d0' },
        text: xhsPageText,
        elements: [],
      },
      navigation: [{ url: 'https://www.xiaohongshu.com/explore/6645a1b2c3d4e5f6a7b8c9d0', ts: 1779200000000 }],
    }));

    fs.writeFileSync(path.join(taskDir, 'network.json'), JSON.stringify([
      { id: '1', url: 'https://edith.xiaohongshu.com/api/sns/web/v1/feed', method: 'POST', status: 200, mimeType: 'application/json' },
      { id: '2', url: 'https://www.xiaohongshu.com/style.css', method: 'GET', status: 200, mimeType: 'text/css' },
    ]));

    const result = extractContent('xhs-test-01');
    assert.equal(result.extraction.platform.name, 'xiaohongshu');
    assert.equal(result.extraction.posts.length, 1);
    assert.equal(result.extraction.apiEndpoints.length, 1);

    const post = result.extraction.posts[0];
    assert.equal(post.platform, 'xiaohongshu');
    assert.equal(post.noteId, '6645a1b2c3d4e5f6a7b8c9d0');
    assert.ok(post.tags.includes('杭州展览'));
    assert.equal(post.engagement.likes, 425);
    assert.equal(post.engagement.saves, 268);
    assert.equal(post.engagement.comments, 32);
    assert.ok(post.qualityScore >= 6);

    // Check output files exist
    assert.ok(fs.existsSync(result.postsFile));
    assert.ok(fs.existsSync(result.extractFile));

    // Check new enrichment fields
    assert.ok(post.category, 'Should have category');
    assert.equal(post.category.primary.name, 'exhibition');
    assert.ok(post.timeliness, 'Should have timeliness');
    assert.ok(post.timeliness.isTimeSensitive, 'Exhibition with dates should be time-sensitive');
    assert.ok(post.hangzhouRelevance, 'Should have hangzhouRelevance');
    assert.ok(post.hangzhouRelevance.isRelevant, 'Hangzhou exhibition post should be relevant');
    assert.ok(post.hangzhouRelevance.matched.includes('杭州'));

    // Check extract.md content
    assert.ok(result.report.includes('小红书'));
    assert.ok(result.report.includes('API Endpoints'));
    assert.ok(result.report.includes('Category'));
  });

  test('extracts multiple posts from XHS feed page', () => {
    const tracesDir = path.join(tmpDir, 'traces');
    const taskDir = path.join(tracesDir, 'xhs-feed-01');
    fs.mkdirSync(taskDir, { recursive: true });

    const traceLines = [
      JSON.stringify({ time: '2026-05-20T10:00:00.000Z', type: 'start', url: 'https://www.xiaohongshu.com/search_result?keyword=杭州展览' }),
      JSON.stringify({ time: '2026-05-20T10:01:00.000Z', type: 'stop', finalUrl: 'https://www.xiaohongshu.com/search_result?keyword=杭州展览' }),
    ];
    fs.writeFileSync(path.join(taskDir, 'trace.jsonl'), traceLines.join('\n') + '\n');

    const feedPageText = `@展览达人小薯
杭州浙江美术馆当代艺术双年展开幕啦
免费参观，截止6月底
#杭州展览# #免费展览#
425赞 268收藏 32评论
@美食探店家
滨江这家咖啡店也太好喝了吧
拔草推荐给大家
#杭州美食# #探店打卡#
189赞 56收藏 12评论
@活动小助手
本周六良渚文化村市集报名开始
报名截止周四，名额有限
#杭州活动# #周末去哪玩#
312赞 145收藏 28评论`;

    fs.writeFileSync(path.join(taskDir, 'pages.json'), JSON.stringify({
      final: {
        info: { title: '杭州展览 - 小红书搜索', url: 'https://www.xiaohongshu.com/search_result?keyword=杭州展览' },
        text: feedPageText,
        elements: [],
      },
      navigation: [{ url: 'https://www.xiaohongshu.com/search_result?keyword=杭州展览', ts: 1779300000000 }],
    }));
    fs.writeFileSync(path.join(taskDir, 'network.json'), JSON.stringify([
      { id: '1', url: 'https://edith.xiaohongshu.com/api/sns/web/v1/search/notes', method: 'POST', status: 200, mimeType: 'application/json' },
    ]));

    const result = extractContent('xhs-feed-01');
    assert.equal(result.extraction.platform.name, 'xiaohongshu');
    assert.ok(result.extraction.posts.length >= 3, `Expected 3+ posts, got ${result.extraction.posts.length}`);

    // All posts should have enrichment
    for (const post of result.extraction.posts) {
      assert.ok(post.qualityScore >= 0, 'Should have quality score');
      assert.ok(post.category, 'Should have category');
      assert.ok(post.timeliness, 'Should have timeliness');
      assert.ok(post.hangzhouRelevance, 'Should have hangzhouRelevance');
      assert.equal(post.source, 'feed_card');
    }

    // First post should be exhibition-related and Hangzhou-relevant
    const first = result.extraction.posts[0];
    assert.ok(first.hangzhouRelevance.isRelevant);
    assert.equal(first.category.primary.name, 'exhibition');

    // Check output files
    assert.ok(fs.existsSync(result.postsFile));
    assert.ok(fs.existsSync(result.extractFile));
    assert.ok(result.report.includes('3'));
  });

  test('handles generic site extraction', () => {
    const tracesDir = path.join(tmpDir, 'traces');
    const taskDir = path.join(tracesDir, 'generic-test-01');
    fs.mkdirSync(taskDir, { recursive: true });

    fs.writeFileSync(path.join(taskDir, 'trace.jsonl'), JSON.stringify({ time: '2026-05-19T10:00:00.000Z', type: 'start', url: 'https://example.com' }) + '\n');
    fs.writeFileSync(path.join(taskDir, 'pages.json'), JSON.stringify({
      final: { info: { title: 'Example', url: 'https://example.com' }, text: 'This is a test page with enough content to be extracted.', elements: [] },
      navigation: [],
    }));
    fs.writeFileSync(path.join(taskDir, 'network.json'), '[]');

    const result = extractContent('generic-test-01');
    assert.equal(result.extraction.platform.name, 'generic');
    assert.equal(result.extraction.posts.length, 1);
  });

  test('throws for non-existent task', () => {
    assert.throws(() => extractContent('does-not-exist-xyz'), /not found/);
  });
});
