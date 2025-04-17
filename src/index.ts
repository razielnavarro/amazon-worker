import { Hono } from 'hono';
import puppeteer, { Cookie } from '@cloudflare/puppeteer';

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url).searchParams.get('url') || 'https://www.amazon.com';
    const app = new Hono<{ Bindings: Env }>();

    app.get('/', async c => {
      const browser = await puppeteer.launch(env.MYBROWSER);
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (…)');

      // 1. Try to load cookies from KV
      const saved: Cookie[] | null = await env.AMAZON_COOKIES.get('amazon-cookies', 'json');
      if (saved && saved.length) {
        console.log('🔑 Loading cookies from KV');
        // spread into setCookie so each cookie gets applied
        await page.setCookie(...saved);
      }

      // 2. Navigate
      await page.goto(url, { waitUntil: 'networkidle0' });

      // 3. Check login state
      let signedIn = false;
      try {
        const text = await page.$eval(
          '#nav-link-accountList .nav-line-1',
          el => el.textContent?.trim() || ''
        );
        signedIn = !/sign in/i.test(text);
      } catch {
        signedIn = false;
      }

      // 4. If not signed in, do login + save cookies
      if (!signedIn) {
        console.log('🔓 Logging in…');
        await page.click('#nav-link-accountList');
        await page.waitForSelector('#ap_email');
        await page.type('#ap_email', 'you@example.com', { delay: 150 });
        await page.keyboard.press('Enter');

        await page.waitForSelector('#ap_password');
        await page.type('#ap_password', 'YourP@ssw0rd', { delay: 150 });
        await page.keyboard.press('Enter');

        // wait for the greeting to appear
        await page.waitForSelector('#nav-link-accountList .nav-line-1');

        // grab fresh cookies and store to KV
        const all = await page.cookies();
        // optional: filter out captcha cookies here
        await env.AMAZON_COOKIES.put('amazon-cookies', JSON.stringify(all));
        console.log('💾 Saved cookies to KV');
      } else {
        console.log('✅ Already signed in via KV cookies');
      }

      await browser.close();
      return c.text('Done');
    });

    return app.fetch(request, env);
  }
} satisfies ExportedHandler<Env>;
