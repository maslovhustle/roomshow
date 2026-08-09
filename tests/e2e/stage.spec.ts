import { expect, test, type Page } from '@playwright/test';

/** Proportion of sampled pixels that are not near-black. */
async function litFraction(page: Page): Promise<number> {
  return page.evaluate(() => {
    const source = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!source) return 0;
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 36;
    const ctx = probe.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(source, 0, 0, probe.width, probe.height);
    const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! + data[i + 1]! + data[i + 2]! > 24) lit++;
    }
    return lit / (data.length / 4);
  });
}

test.describe('the stage', () => {
  test.beforeEach(async ({ page }) => {
    // Keep the session on BroadcastChannel: a build ships working Supabase
    // keys, and a test should not open a realtime connection to them.
    await page.addInitScript(() => {
      localStorage.setItem('roomshow.config', JSON.stringify({ transport: 'local' }));
    });
  });

  test('renders the shader rather than a black rectangle', async ({ page }) => {
    await page.goto('/stage.html?code=TEST');
    await expect(page.locator('#code')).toHaveText('TEST');
    await expect.poll(() => litFraction(page), { timeout: 20_000 }).toBeGreaterThan(0.1);
  });

  test('starts on a look and reports it', async ({ page }) => {
    await page.goto('/stage.html?code=TEST');
    await expect(page.locator('#nowPreset')).toHaveText(/cel · comic/, { timeout: 20_000 });
  });

  test('opens the look named in the URL, which is what the gallery links to', async ({ page }) => {
    await page.goto('/stage.html?code=TEST&look=kodak');
    await expect(page.locator('#nowPreset')).toHaveText(/film · kodak/, { timeout: 20_000 });
  });

  test('ignores an unknown look instead of rendering nothing', async ({ page }) => {
    await page.goto('/stage.html?code=TEST&look=does-not-exist');
    await expect(page.locator('#nowPreset')).toHaveText(/cel · comic/, { timeout: 20_000 });
  });

  test('steps banks with the bracket keys', async ({ page }) => {
    await page.goto('/stage.html?code=TEST');
    await expect(page.locator('#nowPreset')).toHaveText(/cel/, { timeout: 20_000 });
    await page.keyboard.press(']');
    await expect(page.locator('#nowPreset')).toHaveText(/film/, { timeout: 10_000 });
    await page.keyboard.press('[');
    await expect(page.locator('#nowPreset')).toHaveText(/cel/, { timeout: 10_000 });
  });

  test('selects a look within the bank with the number keys', async ({ page }) => {
    await page.goto('/stage.html?code=TEST');
    await expect(page.locator('#nowPreset')).toHaveText(/comic/, { timeout: 20_000 });
    await page.keyboard.press('3');
    await expect(page.locator('#nowPreset')).toHaveText(/cel · manga/, { timeout: 10_000 });
  });

  test('offers the remote link for the same session', async ({ page }) => {
    await page.goto('/stage.html?code=TEST');
    await expect(page.locator('#remoteUrl')).toHaveAttribute('href', /remote\.html\?code=TEST/);
  });
});
