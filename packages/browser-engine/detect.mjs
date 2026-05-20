// Detect Module - 自动登录检测、弹窗/遮罩检测、页面状态感知

export class PageDetector {
  constructor(cdp) {
    this.cdp = cdp;
  }

  async detect(targetId) {
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: DETECT_SCRIPT,
      returnByValue: true,
      awaitPromise: true,
      timeout: 10000,
    });
    return resp.result?.result?.value || { error: 'detection failed' };
  }

  async dismissOverlays(targetId) {
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: DISMISS_SCRIPT,
      returnByValue: true,
      awaitPromise: true,
      timeout: 10000,
    });
    return resp.result?.result?.value || { dismissed: 0 };
  }

  async smartOpen(tabs, stealth, url, group = 'default', waiter = null) {
    const targetId = await tabs.create(url, group);
    if (stealth) { try { await stealth.inject(targetId); } catch {} }
    if (waiter) {
      try { await waiter.waitForStable(targetId, 10000); } catch {}
    } else {
      await new Promise(r => setTimeout(r, 2000));
    }
    const status = await this.detect(targetId);
    if (status.hasOverlay || status.hasCookieBanner) {
      status.overlayDismissed = await this.dismissOverlays(targetId);
    }
    return { targetId, url, status };
  }
}

const DETECT_SCRIPT = `(() => {
  const result = {
    url: location.href,
    title: document.title,
    hasLoginForm: false,
    hasCaptcha: false,
    hasOverlay: false,
    hasCookieBanner: false,
    hasErrorPage: false,
    loginFields: [],
    obstacles: [],
  };

  // 1. Login form detection
  const pwdInputs = document.querySelectorAll('input[type="password"]');
  if (pwdInputs.length > 0) {
    result.hasLoginForm = true;
    pwdInputs.forEach(pwd => {
      const form = pwd.closest('form') || pwd.parentElement;
      if (!form) return;
      const userInput = form.querySelector('input[type="text"],input[type="email"],input[name*="user"],input[name*="account"],input[name*="email"],input[id*="user"],input[id*="email"],input[placeholder*="用户"],input[placeholder*="账号"],input[placeholder*="邮箱"]');
      result.loginFields.push({
        userSelector: userInput ? (userInput.id ? '#'+userInput.id : userInput.name ? 'input[name="'+userInput.name+'"]' : null) : null,
        passSelector: pwd.id ? '#'+pwd.id : pwd.name ? 'input[name="'+pwd.name+'"]' : 'input[type="password"]',
        formAction: form.tagName === 'FORM' ? form.action : null,
        submitBtn: form.querySelector('button[type="submit"],input[type="submit"]') ? true : false,
      });
    });
  }

  // Also check URL/title patterns
  const loginKeywords = ['login','signin','sign-in','log-in','登录','登陆'];
  const urlLower = location.href.toLowerCase();
  const titleLower = document.title.toLowerCase();
  if (!result.hasLoginForm && loginKeywords.some(k => urlLower.includes(k) || titleLower.includes(k))) {
    result.hasLoginForm = true;
  }

  // 2. Captcha detection
  const captchaSelectors = [
    'iframe[src*="recaptcha"]','iframe[src*="hcaptcha"]','iframe[src*="captcha"]',
    '.g-recaptcha','[data-sitekey]','#captcha','[class*="captcha"]',
    'img[src*="captcha"]','img[src*="verify"]','img[alt*="验证"]',
    '[class*="verify"]','[id*="captcha"]',
  ];
  for (const sel of captchaSelectors) {
    if (document.querySelector(sel)) {
      result.hasCaptcha = true;
      result.obstacles.push({ type: 'captcha', selector: sel });
      break;
    }
  }

  // 3. Overlay/modal detection
  const allEls = document.querySelectorAll('div,section,aside');
  for (const el of allEls) {
    const style = getComputedStyle(el);
    if (style.position === 'fixed' && style.zIndex > 999 &&
        el.offsetWidth > window.innerWidth * 0.5 && el.offsetHeight > window.innerHeight * 0.5 &&
        style.display !== 'none' && style.visibility !== 'hidden') {
      result.hasOverlay = true;
      result.obstacles.push({
        type: 'overlay',
        tag: el.tagName,
        id: el.id || '',
        classes: (el.className || '').toString().slice(0, 80),
        size: el.offsetWidth + 'x' + el.offsetHeight,
      });
      break;
    }
  }

  // 4. Cookie banner detection
  const cookieSelectors = [
    '[class*="cookie"]','[id*="cookie"]','[class*="consent"]','[id*="consent"]',
    '[class*="gdpr"]','[id*="gdpr"]','[class*="privacy-banner"]',
    '[aria-label*="cookie"]','[aria-label*="consent"]',
  ];
  for (const sel of cookieSelectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
      result.hasCookieBanner = true;
      result.obstacles.push({ type: 'cookie-banner', selector: sel });
      break;
    }
  }

  // 5. Error page detection
  const errorPatterns = ['404','403','500','502','503','not found','forbidden','error','错误','页面不存在','访问被拒绝'];
  const bodyText = (document.body?.innerText || '').slice(0, 500).toLowerCase();
  for (const p of errorPatterns) {
    if (titleLower.includes(p) && bodyText.length < 1000) {
      result.hasErrorPage = true;
      result.obstacles.push({ type: 'error-page', pattern: p });
      break;
    }
  }

  return result;
})()`;

const DISMISS_SCRIPT = `(() => {
  let dismissed = 0;

  // 1. Close cookie banners
  const cookieCloseSelectors = [
    '[class*="cookie"] button','[id*="cookie"] button',
    '[class*="consent"] button','[id*="consent"] button',
    '[class*="cookie"] [class*="close"]','[class*="cookie"] [class*="accept"]',
    '[class*="consent"] [class*="accept"]','[class*="consent"] [class*="agree"]',
    'button[class*="accept"]','a[class*="accept"]',
  ];
  for (const sel of cookieCloseSelectors) {
    const btns = document.querySelectorAll(sel);
    for (const btn of btns) {
      if (btn.offsetWidth > 0 && btn.offsetHeight > 0) {
        btn.click();
        dismissed++;
      }
    }
  }

  // 2. Close fixed overlays
  const allEls = document.querySelectorAll('div,section,aside');
  for (const el of allEls) {
    const style = getComputedStyle(el);
    if (style.position === 'fixed' && parseInt(style.zIndex) > 999 &&
        el.offsetWidth > window.innerWidth * 0.5 && el.offsetHeight > window.innerHeight * 0.5) {
      // Try clicking close button inside
      const closeBtn = el.querySelector('[class*="close"],button[aria-label*="close"],button[aria-label*="关闭"],.close-btn,.close');
      if (closeBtn) {
        closeBtn.click();
        dismissed++;
      } else {
        // Remove directly
        el.style.display = 'none';
        dismissed++;
      }
    }
  }

  // 3. Remove background scroll lock
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';

  return { dismissed };
})()`;

export default PageDetector;
