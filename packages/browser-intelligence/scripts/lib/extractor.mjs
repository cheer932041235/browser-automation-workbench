/**
 * extractor.mjs — Structured content extraction from recorded traces
 *
 * Reads Recorder output (pages.json, network.json, trace.jsonl) and extracts
 * structured content items (posts, articles, listings). Supports platform-
 * specific parsers (Xiaohongshu first, extensible to others).
 *
 * Output: posts.json in the task directory
 */

import fs from 'node:fs';
import path from 'node:path';
import { tracesDir } from './paths.mjs';

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

const PLATFORM_RULES = [
  {
    name: 'xiaohongshu',
    label: '小红书',
    match: (url) => /xiaohongshu\.com|xhslink\.com/i.test(url),
    parseText: parseXhsText,
    parseNetwork: parseXhsNetwork,
  },
  {
    name: 'generic',
    label: 'Generic',
    match: () => true,
    parseText: parseGenericText,
    parseNetwork: parseGenericNetwork,
  },
];

function detectPlatform(urls) {
  const allUrls = urls.join(' ');
  for (const rule of PLATFORM_RULES) {
    if (rule.name !== 'generic' && rule.match(allUrls)) {
      return rule;
    }
  }
  return PLATFORM_RULES.find(r => r.name === 'generic');
}

// ---------------------------------------------------------------------------
// Data loading (shared with reviewer, but kept independent)
// ---------------------------------------------------------------------------

function loadTrace(taskDir) {
  const file = path.join(taskDir, 'trace.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function loadNetwork(taskDir) {
  const file = path.join(taskDir, 'network.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function loadPages(taskDir) {
  const file = path.join(taskDir, 'pages.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Xiaohongshu parser
// ---------------------------------------------------------------------------

/**
 * Parse XHS post structure from page text content.
 *
 * XHS web page text typically contains:
 *   - Author name (often near top)
 *   - Post title (first prominent text)
 *   - Post body
 *   - Hashtags (#tag#)
 *   - Engagement metrics (likes, saves, comments)
 *   - Date
 */
function parseXhsText(text, pageInfo) {
  if (!text || text.length < 20) return null;

  const post = {
    platform: 'xiaohongshu',
    source: 'page_text',
    url: pageInfo?.url || '',
    noteId: extractXhsNoteId(pageInfo?.url || ''),
    title: '',
    body: '',
    author: '',
    tags: [],
    publishTime: '',
    engagement: { likes: null, saves: null, comments: null },
    rawText: text,
  };

  // Extract hashtags: #tag# or #tag（XHS style）
  const tagMatches = text.match(/#([^#\n]{1,30})#/g) || [];
  post.tags = tagMatches.map(t => t.replace(/#/g, '').trim()).filter(Boolean);

  // Try to find engagement numbers
  // Common patterns: "123赞" "45评论" "67收藏" or "123 likes" etc.
  const likeMatch = text.match(/(\d[\d,.]*)\s*(?:赞|点赞|likes?|❤)/i);
  const saveMatch = text.match(/(\d[\d,.]*)\s*(?:收藏|saves?|⭐)/i);
  const commentMatch = text.match(/(\d[\d,.]*)\s*(?:评论|comments?|💬)/i);
  if (likeMatch) post.engagement.likes = parseEngagementNumber(likeMatch[1]);
  if (saveMatch) post.engagement.saves = parseEngagementNumber(saveMatch[1]);
  if (commentMatch) post.engagement.comments = parseEngagementNumber(commentMatch[1]);

  // Try to find publish time
  // Common patterns: "2026-05-19" "3天前" "昨天" "05-19" "2026年5月19日"
  const dateMatch = text.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})|(\d{1,2}[-/.]\d{1,2})|(\d+\s*(?:天前|小时前|分钟前|秒前))|昨天|前天|(\d{4}年\d{1,2}月\d{1,2}日)/);
  if (dateMatch) post.publishTime = dateMatch[0];

  // Split text into lines for structure detection
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Heuristic: first substantial line (>5 chars, not a hashtag) is likely title
  // Skip very short lines (likely UI elements)
  const contentLines = lines.filter(l =>
    l.length > 3 &&
    !l.startsWith('#') &&
    !/^\d+$/.test(l) &&
    !/^(赞|收藏|评论|分享|关注|取消)/.test(l)
  );

  if (contentLines.length > 0) {
    // Title is usually the first or second meaningful line
    post.title = contentLines[0].slice(0, 200);
    // Body is the rest joined
    post.body = contentLines.slice(1).join('\n').slice(0, 5000);
  }

  // Try to extract author from common patterns
  // XHS pages often have "作者名" near top, or "@author"
  const authorMatch = text.match(/@([^\s@#]{1,30})/);
  if (authorMatch) post.author = authorMatch[1];

  return post;
}

function extractXhsNoteId(url) {
  if (!url) return '';
  // /explore/{noteId} or /discovery/item/{noteId}
  const match = url.match(/\/(?:explore|discovery\/item)\/([a-f0-9]{24})/i);
  return match ? match[1] : '';
}

/**
 * Parse XHS API responses from network requests.
 * XHS web uses APIs like:
 *   - /api/sns/web/v1/feed
 *   - /api/sns/web/v1/note/{noteId}
 *   - /api/sns/web/v2/note/collect/page
 */
function parseXhsNetwork(requests) {
  const apiPosts = [];
  const xhsApiPatterns = [
    /\/api\/sns\/web\/v\d+\/feed/,
    /\/api\/sns\/web\/v\d+\/note/,
    /\/api\/sns\/web\/v\d+\/search/,
    /\/api\/sns\/web\/v\d+\/homefeed/,
  ];

  for (const req of requests) {
    const url = req.url || '';
    const isXhsApi = xhsApiPatterns.some(p => p.test(url));
    if (!isXhsApi) continue;

    apiPosts.push({
      apiUrl: url,
      method: req.method || 'GET',
      status: req.status,
      mimeType: req.mimeType,
      classification: 'xhs_api',
    });
  }

  return apiPosts;
}

// ---------------------------------------------------------------------------
// Multi-post extraction (feed / search pages)
// ---------------------------------------------------------------------------

/**
 * Detect if the current page is a feed/search page (multiple posts)
 * vs a single-post detail page.
 */
function isXhsFeedPage(pageInfo, pageText) {
  const url = pageInfo?.url || '';
  // Feed/search page URL patterns
  if (/\/search_result/.test(url)) return true;
  if (/\/explore\/?$/.test(url)) return true;
  if (/\/explore\?/.test(url)) return true;
  // Home feed
  if (/xiaohongshu\.com\/?$/.test(url)) return true;
  if (/xiaohongshu\.com\/\?/.test(url)) return true;

  // Heuristic: multiple engagement patterns suggest feed page
  const engagementOccurrences = (pageText.match(/(\d[\d,.]*)\s*(?:赞|点赞)/g) || []).length;
  if (engagementOccurrences >= 3) return true;

  return false;
}

/**
 * Split feed/search page text into individual post segments.
 * XHS feed pages typically show post cards with:
 *   - Author name
 *   - Title/snippet (short)
 *   - Engagement (likes)
 * separated by repetitive UI elements.
 */
function parseXhsFeedText(text, pageInfo) {
  if (!text || text.length < 30) return [];

  const posts = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Strategy: segment by engagement patterns (each “N赞” likely ends a card)
  // Also look for repeated structural markers
  const segments = [];
  let current = [];

  for (const line of lines) {
    current.push(line);
    // End-of-card heuristic: line contains engagement count or is a UI separator
    const isEngagementLine = /\d[\d,.]*\s*(赞|点赞|likes?)/.test(line);
    const isSeparator = /^(\u2014{3,}|\-{3,}|\={3,})$/.test(line);
    if (isEngagementLine || isSeparator) {
      if (current.length >= 2) {
        segments.push([...current]);
      }
      current = [];
    }
  }
  // Push remaining if substantial
  if (current.length >= 2) {
    segments.push(current);
  }

  // If segmentation didn't work well (too few segments), try alternative: split by author pattern
  if (segments.length < 2) {
    return splitByAuthorPattern(lines, pageInfo);
  }

  for (const seg of segments) {
    const segText = seg.join('\n');
    const post = parseSegmentAsPost(segText, pageInfo);
    if (post) posts.push(post);
  }

  return posts;
}

/**
 * Alternative segmentation: split by @author or repeated short-name patterns
 */
function splitByAuthorPattern(lines, pageInfo) {
  const posts = [];
  const segments = [];
  let current = [];

  for (const line of lines) {
    // New segment starts with @author pattern or very short name-like line after gap
    if (current.length > 0 && /^@[^\s@]{1,30}$/.test(line)) {
      segments.push([...current]);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length >= 2) segments.push(current);

  for (const seg of segments) {
    const segText = seg.join('\n');
    const post = parseSegmentAsPost(segText, pageInfo);
    if (post) posts.push(post);
  }

  return posts;
}

/**
 * Parse a text segment (from feed splitting) as a single post card.
 */
function parseSegmentAsPost(segText, pageInfo) {
  if (!segText || segText.length < 10) return null;

  const post = {
    platform: 'xiaohongshu',
    source: 'feed_card',
    url: pageInfo?.url || '',
    noteId: '',
    title: '',
    body: '',
    author: '',
    tags: [],
    publishTime: '',
    engagement: { likes: null, saves: null, comments: null },
    rawText: segText,
  };

  // Extract tags
  const tagMatches = segText.match(/#([^#\n]{1,30})#/g) || [];
  post.tags = tagMatches.map(t => t.replace(/#/g, '').trim()).filter(Boolean);

  // Extract engagement
  const likeMatch = segText.match(/(\d[\d,.]*)\s*(?:赞|点赞|likes?|❤)/i);
  const saveMatch = segText.match(/(\d[\d,.]*)\s*(?:收藏|saves?|⭐)/i);
  const commentMatch = segText.match(/(\d[\d,.]*)\s*(?:评论|comments?|💬)/i);
  if (likeMatch) post.engagement.likes = parseEngagementNumber(likeMatch[1]);
  if (saveMatch) post.engagement.saves = parseEngagementNumber(saveMatch[1]);
  if (commentMatch) post.engagement.comments = parseEngagementNumber(commentMatch[1]);

  // Extract author
  const authorMatch = segText.match(/@([^\s@#]{1,30})/);
  if (authorMatch) post.author = authorMatch[1];

  // Extract noteId from any link in segment
  const noteIdMatch = segText.match(/\/(?:explore|discovery\/item)\/([a-f0-9]{24})/i);
  if (noteIdMatch) post.noteId = noteIdMatch[1];

  // Title: first content line
  const contentLines = segText.split('\n').map(l => l.trim()).filter(l =>
    l.length > 3 &&
    !l.startsWith('#') &&
    !/^\d+$/.test(l) &&
    !/^@/.test(l) &&
    !/^(赞|收藏|评论|分享|关注)/.test(l)
  );

  if (contentLines.length > 0) {
    post.title = contentLines[0].slice(0, 200);
    post.body = contentLines.slice(1).join('\n').slice(0, 2000);
  }

  // Skip segments that are purely UI noise (no title and no engagement)
  if (!post.title && post.engagement.likes === null) return null;

  return post;
}

// ---------------------------------------------------------------------------
// Generic parser (fallback)
// ---------------------------------------------------------------------------

function parseGenericText(text, pageInfo) {
  if (!text || text.length < 20) return null;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const contentLines = lines.filter(l => l.length > 3);

  return {
    platform: 'generic',
    source: 'page_text',
    url: pageInfo?.url || '',
    noteId: '',
    title: pageInfo?.title || (contentLines.length > 0 ? contentLines[0].slice(0, 200) : ''),
    body: contentLines.join('\n').slice(0, 5000),
    author: '',
    tags: [],
    publishTime: '',
    engagement: { likes: null, saves: null, comments: null },
    rawText: text,
  };
}

function parseGenericNetwork(requests) {
  return requests
    .filter(req => {
      const mime = (req.mimeType || '').toLowerCase();
      return mime.includes('json') && (req.url || '').includes('/api/');
    })
    .map(req => ({
      apiUrl: req.url,
      method: req.method || 'GET',
      status: req.status,
      mimeType: req.mimeType,
      classification: 'generic_api',
    }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEngagementNumber(str) {
  if (!str) return null;
  const cleaned = str.replace(/[,.]/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

function collectUrls(trace, pages) {
  const urls = [];
  for (const event of trace) {
    if (event.url) urls.push(event.url);
    if (event.finalUrl) urls.push(event.finalUrl);
    if (event.opened?.url) urls.push(event.opened.url);
  }
  if (pages?.final?.info?.url) urls.push(pages.final.info.url);
  if (pages?.navigation) {
    for (const nav of pages.navigation) {
      if (nav.url) urls.push(nav.url);
    }
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Content quality scoring
// ---------------------------------------------------------------------------

function scorePost(post) {
  let score = 0;
  if (post.title && post.title.length > 5) score += 2;
  if (post.body && post.body.length > 30) score += 3;
  if (post.author) score += 1;
  if (post.tags.length > 0) score += 1;
  if (post.publishTime) score += 1;
  if (post.engagement.likes !== null) score += 1;
  if (post.noteId) score += 1;
  return score; // max 10
}

// ---------------------------------------------------------------------------
// Content categorization
// ---------------------------------------------------------------------------

const CATEGORY_RULES = [
  { name: 'exhibition',  label: '展览',   keywords: ['展览', '展出', '美术馆', '博物馆', '画展', '艺术展', '开展', '闭展', '特展', '常设展', '临展', '参观', '美院'] },
  { name: 'event',       label: '活动',   keywords: ['活动', '市集', '市集', '音乐节', '演出', '嘉年华', '节日', '庆典', '开幕', '报名', '报名链接', '招募', '志愿者'] },
  { name: 'food',        label: '美食',   keywords: ['美食', '餐厅', '探店', '吃饭', '小吃', '咖啡', '甜品', '火锅', '烧烤', '下午茶', '早餐', '晚餐', '拔草', '排雷', '好吃'] },
  { name: 'social',      label: '社交',   keywords: ['社交', '组局', '拼玩', '约伴', '拼饭', '来聊天', '朋友', '共创', '互助', '联谊', '美妆沙龙', '读书会'] },
  { name: 'resource',    label: '资源',   keywords: ['免费', '羊毛', '红利', '福利', '优惠', '折扣', '补贴', '赠送', '兑换', '试用', '领取', '资源', '工具', '分享'] },
  { name: 'travel',      label: '游玩',   keywords: ['打卡', '游玩', '旅行', '景点', '攻略', '路线', '周边游', '自驾', '民宿', '酒店', '拍照', '拍写', '出片'] },
  { name: 'life',        label: '生活',   keywords: ['租房', '房租', '搬家', '装修', '家居', '健身', '医院', '体检', '加班', '通勤', '区位', '购物'] },
];

function categorizePost(post) {
  const text = `${post.title} ${post.body} ${post.tags.join(' ')}`.toLowerCase();
  const matches = [];

  for (const rule of CATEGORY_RULES) {
    const hitCount = rule.keywords.filter(kw => text.includes(kw)).length;
    if (hitCount > 0) {
      matches.push({ name: rule.name, label: rule.label, hits: hitCount });
    }
  }

  // Sort by hit count descending
  matches.sort((a, b) => b.hits - a.hits);

  return {
    primary: matches.length > 0 ? matches[0] : { name: 'uncategorized', label: '未分类', hits: 0 },
    all: matches,
  };
}

// ---------------------------------------------------------------------------
// Timeliness detection
// ---------------------------------------------------------------------------

const TIME_PATTERNS = [
  // “xxx至xxx” date ranges
  { re: /(\d{1,2}月\d{1,2}日?)[\s~\-—至到]{1,4}(\d{1,2}月\d{1,2}日?)/, type: 'date_range' },
  // “即日起至xxx”
  { re: /即日起[\s~\-—至到]{0,4}(\d{1,4}[\-./年]\d{1,2}[\-./月]\d{1,2}日?)/, type: 'open_until' },
  // Full date: 2026-05-20, 2026年5月20日, 2026/05/20
  { re: /(\d{4})[\-./年](\d{1,2})[\-./月](\d{1,2})日?/, type: 'date' },
  // Short date: 5月20日, 05-20
  { re: /(\d{1,2})[\-./月](\d{1,2})日?/, type: 'short_date' },
  // Relative: 3天后, 本周六, 这周末
  { re: /(明天|后天|大后天|本周[一二三四五六日天末]|这周[一二三四五六日天末]|下周[一二三四五六日天末]|\d+天后)/, type: 'relative' },
  // Deadline keywords
  { re: /(截止|报名截止|最后一天|最后机会|即将结束|仅剩)/, type: 'deadline' },
];

function detectTimeliness(post) {
  const text = `${post.title} ${post.body} ${post.publishTime}`;
  const signals = [];

  for (const pattern of TIME_PATTERNS) {
    const match = text.match(pattern.re);
    if (match) {
      signals.push({ type: pattern.type, matched: match[0] });
    }
  }

  const hasDeadline = signals.some(s => s.type === 'deadline');
  const hasDateRange = signals.some(s => s.type === 'date_range' || s.type === 'open_until');
  const hasAnyDate = signals.length > 0;

  let urgency = 'none';
  if (hasDeadline) urgency = 'high';
  else if (hasDateRange) urgency = 'medium';
  else if (hasAnyDate) urgency = 'low';

  return { urgency, signals, isTimeSensitive: urgency !== 'none' };
}

// ---------------------------------------------------------------------------
// Hangzhou relevance scoring (user’s primary interest area)
// ---------------------------------------------------------------------------

const HANGZHOU_KEYWORDS = [
  '杭州', '西湖', '滨江', '余杭', '萧山', '临平', '临安', '富阳', '桐庐', '建德', '淣安',
  '钱塘', '江干', '拱墅', '下城', '上城', '江城', '北山', '神湾',
  '浙大', '浙江大学', '之江', '浙江省博', '浙江美术馆', '良渚',
  '西溪湿地', '天目里', '河坊', '南宋御街', '湖滨银泰',
];

function scoreHangzhouRelevance(post) {
  const text = `${post.title} ${post.body} ${post.tags.join(' ')}`;
  let score = 0;
  const matched = [];

  for (const kw of HANGZHOU_KEYWORDS) {
    if (text.includes(kw)) {
      score += (kw === '杭州' ? 2 : 1);
      matched.push(kw);
    }
  }

  return { score, matched, isRelevant: score > 0 };
}

// ---------------------------------------------------------------------------
// Markdown report generation
// ---------------------------------------------------------------------------

function generateExtractReport(extraction) {
  const { taskId, platform, posts, apiEndpoints, meta } = extraction;
  const lines = [];

  lines.push(`# Content Extract: ${taskId}`);
  lines.push('');
  lines.push(`- **Platform**: ${platform.label} (\`${platform.name}\`)`);
  lines.push(`- **Posts extracted**: ${posts.length}`);
  lines.push(`- **API endpoints found**: ${apiEndpoints.length}`);
  lines.push(`- **Source URL**: ${meta.sourceUrl || 'unknown'}`);
  lines.push(`- **Extracted at**: ${new Date().toISOString()}`);
  lines.push('');

  if (posts.length > 0) {
    lines.push('## Posts');
    lines.push('');
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      lines.push(`### ${i + 1}. ${post.title || '(untitled)'}`);
      lines.push('');
      if (post.author) lines.push(`- **Author**: ${post.author}`);
      if (post.url) lines.push(`- **URL**: ${post.url}`);
      if (post.noteId) lines.push(`- **Note ID**: ${post.noteId}`);
      if (post.publishTime) lines.push(`- **Time**: ${post.publishTime}`);
      if (post.tags.length > 0) lines.push(`- **Tags**: ${post.tags.map(t => `#${t}`).join(' ')}`);
      const eng = post.engagement;
      if (eng.likes !== null || eng.saves !== null || eng.comments !== null) {
        const parts = [];
        if (eng.likes !== null) parts.push(`${eng.likes} 赞`);
        if (eng.saves !== null) parts.push(`${eng.saves} 收藏`);
        if (eng.comments !== null) parts.push(`${eng.comments} 评论`);
        lines.push(`- **Engagement**: ${parts.join(' / ')}`);
      }
      lines.push(`- **Quality score**: ${post.qualityScore}/10`);
      lines.push('');
      // Category
      if (post.category) {
        const cats = post.category.all.length > 0
          ? post.category.all.map(c => `${c.label}(${c.hits})`).join(', ')
          : '未分类';
        lines.push(`- **Category**: ${cats}`);
      }
      // Timeliness
      if (post.timeliness?.isTimeSensitive) {
        const signals = post.timeliness.signals.map(s => `${s.type}: ${s.matched}`).join('; ');
        lines.push(`- **Timeliness**: ⚠️ ${post.timeliness.urgency} urgency — ${signals}`);
      }
      // Hangzhou relevance
      if (post.hangzhouRelevance?.isRelevant) {
        lines.push(`- **Hangzhou Relevance**: score ${post.hangzhouRelevance.score} — matched: ${post.hangzhouRelevance.matched.join(', ')}`);
      }
      lines.push('');
      if (post.body) {
        // Show first 500 chars of body
        const preview = post.body.slice(0, 500);
        lines.push('> ' + preview.replace(/\n/g, '\n> '));
        if (post.body.length > 500) lines.push(`> ... (${post.body.length} chars total)`);
        lines.push('');
      }
    }
  }

  if (apiEndpoints.length > 0) {
    lines.push('## API Endpoints Detected');
    lines.push('');
    lines.push('| Method | URL | Status | Type |');
    lines.push('|--------|-----|--------|------|');
    for (const ep of apiEndpoints) {
      const urlShort = ep.apiUrl.length > 70 ? ep.apiUrl.slice(0, 67) + '...' : ep.apiUrl;
      lines.push(`| ${ep.method} | ${urlShort} | ${ep.status ?? '—'} | ${ep.classification} |`);
    }
    lines.push('');
  }

  // Extraction hints
  lines.push('## Extraction Quality Notes');
  lines.push('');
  if (posts.length === 0) {
    lines.push('- No posts could be extracted from page text. This may indicate:');
    lines.push('  - The page content was not captured (recording too short?)');
    lines.push('  - The platform uses dynamic rendering that textContent missed');
    lines.push('  - The page was a search results list rather than a single post');
  } else {
    const avgScore = posts.reduce((s, p) => s + p.qualityScore, 0) / posts.length;
    lines.push(`- Average quality score: **${avgScore.toFixed(1)}/10**`);
    if (avgScore < 4) {
      lines.push('- Low quality — text extraction may have missed structured content');
      lines.push('- Consider using `/eval` in Browser Engine to run DOM-specific extraction');
    } else if (avgScore < 7) {
      lines.push('- Moderate quality — core content captured, some metadata missing');
    } else {
      lines.push('- Good quality — structured content extracted successfully');
    }
  }

  if (apiEndpoints.length > 0) {
    lines.push(`- ${apiEndpoints.length} API endpoint(s) detected — these may contain richer structured data`);
    lines.push('- Future: intercept response bodies for full post JSON');
  }
  lines.push('');

  lines.push('---');
  lines.push(`*Extracted from: \`${extraction.taskDir}\`*`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function extractContent(taskId) {
  const safeName = taskId.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  const taskDir = path.join(tracesDir, safeName);

  if (!fs.existsSync(taskDir)) {
    throw new Error(`Task directory not found: ${taskDir}`);
  }

  const trace = loadTrace(taskDir);
  const network = loadNetwork(taskDir);
  const pages = loadPages(taskDir);

  const urls = collectUrls(trace, pages);
  const platform = detectPlatform(urls);

  // Extract posts from page text
  const pageText = pages?.final?.text || '';
  const pageInfo = pages?.final?.info || {};

  const posts = [];

  // Check if this is a feed/search page (multiple posts) or single post
  if (platform.name === 'xiaohongshu' && isXhsFeedPage(pageInfo, pageText)) {
    const feedPosts = parseXhsFeedText(pageText, pageInfo);
    for (const p of feedPosts) {
      p.qualityScore = scorePost(p);
      p.category = categorizePost(p);
      p.timeliness = detectTimeliness(p);
      p.hangzhouRelevance = scoreHangzhouRelevance(p);
      posts.push(p);
    }
  } else {
    const textPost = platform.parseText(pageText, pageInfo);
    if (textPost) {
      textPost.qualityScore = scorePost(textPost);
      textPost.category = categorizePost(textPost);
      textPost.timeliness = detectTimeliness(textPost);
      textPost.hangzhouRelevance = scoreHangzhouRelevance(textPost);
      posts.push(textPost);
    }
  }

  // Extract API endpoints
  const apiEndpoints = platform.parseNetwork(network);

  // Determine source URL
  const startEvent = trace.find(e => e.type === 'start');
  const sourceUrl = pageInfo.url || startEvent?.url || urls[0] || '';

  const extraction = {
    taskId: safeName,
    taskDir,
    platform: { name: platform.name, label: platform.label },
    posts,
    apiEndpoints,
    meta: {
      sourceUrl,
      extractedAt: new Date().toISOString(),
      traceEvents: trace.length,
      networkRequests: network.length,
      pageTextLength: pageText.length,
    },
  };

  // Write posts.json
  const postsFile = path.join(taskDir, 'posts.json');
  fs.writeFileSync(postsFile, JSON.stringify(extraction, null, 2), 'utf-8');

  // Write extract.md report
  const report = generateExtractReport(extraction);
  const extractFile = path.join(taskDir, 'extract.md');
  fs.writeFileSync(extractFile, report, 'utf-8');

  return { extraction, report, postsFile, extractFile };
}

export {
  extractContent,
  detectPlatform,
  parseXhsText,
  parseXhsNetwork,
  parseXhsFeedText,
  isXhsFeedPage,
  parseGenericText,
  parseGenericNetwork,
  extractXhsNoteId,
  scorePost,
  parseEngagementNumber,
  collectUrls,
  categorizePost,
  detectTimeliness,
  scoreHangzhouRelevance,
  PLATFORM_RULES,
  CATEGORY_RULES,
  HANGZHOU_KEYWORDS,
};
