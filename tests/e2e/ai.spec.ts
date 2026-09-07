import { expect, test } from '@playwright/test';

const UNREACHABLE = 'ws://127.0.0.1:59999';

test.describe('the AI engine', () => {
  test('stays out of the way when no endpoint is configured', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('roomshow.config', JSON.stringify({ transport: 'local' }));
    });
    await page.goto('/stage.html?code=NOAI');
    await expect(page.locator('#nowPreset')).toHaveText(/cel · comic/, { timeout: 20_000 });
    await expect(page.locator('#aiStatus')).toBeHidden();
  });

  // The regression this guards: both canvases carry `display: block`, which
  // outranks the user-agent rule for [hidden], so the inactive engine's canvas
  // sat over the active one and the projector went black.
  test('keeps the shader on screen when the endpoint is unreachable', async ({ page }) => {
    await page.addInitScript((url) => {
      localStorage.setItem('roomshow.config', JSON.stringify({ transport: 'local', diffusionUrl: url }));
    }, UNREACHABLE);

    await page.goto('/stage.html?code=FALL');
    await expect(page.locator('#aiStatus')).toHaveAttribute('data-state', 'offline', { timeout: 20_000 });

    await page.keyboard.press('a');

    await expect(page.locator('#stageAi')).toBeHidden();
    await expect(page.locator('#stage')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const source = document.querySelector('#stage') as HTMLCanvasElement;
      const probe = document.createElement('canvas');
      probe.width = 48;
      probe.height = 27;
      const ctx = probe.getContext('2d');
      if (!ctx) return 0;
      ctx.drawImage(source, 0, 0, probe.width, probe.height);
      const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! + data[i + 1]! + data[i + 2]! > 24) lit++;
      }
      return lit / (data.length / 4);
    }), { timeout: 20_000 }).toBeGreaterThan(0.1);
  });

  test('offers prompts on the remote only once the AI engine is picked', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('roomshow.config', JSON.stringify({ transport: 'local' }));
    });
    await page.goto('/remote.html?code=PROM');

    await expect(page.locator('#aiPanel')).toBeHidden();
    await page.locator('[data-engine="ai"]').click();
    await expect(page.locator('#aiPanel')).toBeVisible();
    await expect(page.locator('#styles button')).toHaveCount(12);
  });

  test('fills the box from a style, so the next tap edits a real sentence', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('roomshow.config', JSON.stringify({ transport: 'local' }));
    });
    await page.goto('/remote.html?code=PROM');
    await page.locator('[data-engine="ai"]').click();
    await page.locator('#styles button').first().click();
    await expect(page.locator('#prompt')).toHaveValue(/cel animation/);
  });
});
