import http from 'node:http';

const DEFAULT_BASE_URL = process.env.BROWSER_ENGINE_URL || 'http://127.0.0.1:3456';

class EngineUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'EngineUnavailableError';
    this.cause = cause;
  }
}

function requestJson(pathname, { method = 'GET', body, timeout = 5000, baseUrl = DEFAULT_BASE_URL } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(url, { method, headers, timeout }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let parsed = raw;
        try { parsed = raw ? JSON.parse(raw) : null; } catch {}
        if (res.statusCode >= 400) {
          const message = typeof parsed === 'object' && parsed?.error ? parsed.error : `HTTP ${res.statusCode}`;
          reject(new Error(message));
          return;
        }
        resolve(parsed);
      });
    });

    req.on('timeout', () => {
      req.destroy(new EngineUnavailableError(`Browser Engine request timed out: ${url.href}`));
    });
    req.on('error', (error) => {
      if (error instanceof EngineUnavailableError) reject(error);
      else reject(new EngineUnavailableError(`Browser Engine unavailable: ${baseUrl}`, error));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

function getJson(pathname, options) {
  return requestJson(pathname, { ...options, method: 'GET' });
}

function postJson(pathname, body, options) {
  return requestJson(pathname, { ...options, method: 'POST', body });
}

async function getHealth(options) {
  return getJson('/health', options);
}

async function getHelp(options) {
  return getJson('/help', options);
}

async function getTabs(options) {
  return getJson('/tabs', options);
}

export {
  DEFAULT_BASE_URL,
  EngineUnavailableError,
  requestJson,
  getJson,
  postJson,
  getHealth,
  getHelp,
  getTabs,
};
