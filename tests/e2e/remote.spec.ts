import { expect, test } from '@playwright/test';

// One browser context on purpose: BroadcastChannel is same-origin and
// same-profile, so two pages in one context stand in for the two devices
// without needing a Supabase project in CI.
test.describe('the phone driving the stage', () => {
  test('applies a look tapped on the remote', async ({ context }) => {
    await context.addInitScript(() => {
      localStorage.setItem('roomshow.config', JSON.stringify({ transport: 'local' }));
    });

    const stage = await context.newPage();
    await stage.goto('/stage.html?code=PAIR');
    await expect(stage.locator('#nowPreset')).toHaveText(/cel · comic/, { timeout: 20_000 });

    const remote = await context.newPage();
    await remote.goto('/remote.html?code=PAIR');
    await expect(remote.locator('#status')).toHaveText('connected', { timeout: 20_000 });

    await remote.locator('[data-bank="film"]').click();
    await remote.locator('[data-id="cinestill"]').click();

    await expect(stage.locator('#nowPreset')).toHaveText(/film · cinestill/, { timeout: 15_000 });
  });

  test('reflects the stage back onto a remote that joins late', async ({ context }) => {
    await context.addInitScript(() => {
      localStorage.setItem('roomshow.config', JSON.stringify({ transport: 'local' }));
    });

    const stage = await context.newPage();
    await stage.goto('/stage.html?code=LATE');
    await expect(stage.locator('#nowPreset')).toHaveText(/comic/, { timeout: 20_000 });
    await stage.keyboard.press(']');
    await expect(stage.locator('#nowPreset')).toHaveText(/film · kodak/, { timeout: 10_000 });

    const remote = await context.newPage();
    await remote.goto('/remote.html?code=LATE');

    // The stage rebroadcasts its state, so a phone opened afterwards lands on
    // the truth without anyone touching it.
    await expect(remote.locator('[data-id="kodak"]')).toHaveClass(/active/, { timeout: 20_000 });
  });

  test('rides the intensity fader without waiting for the finger to lift', async ({ context }) => {
    await context.addInitScript(() => {
      localStorage.setItem('roomshow.config', JSON.stringify({ transport: 'local' }));
    });

    const stage = await context.newPage();
    await stage.goto('/stage.html?code=FADE');
    const remote = await context.newPage();
    await remote.goto('/remote.html?code=FADE');
    await expect(remote.locator('#status')).toHaveText('connected', { timeout: 20_000 });

    await remote.locator('#intensity').fill('20');
    await remote.locator('#intensity').dispatchEvent('input');

    await expect(remote.locator('#intensityValue')).toHaveText('20%');
  });

  test('explains itself when the link carries no session', async ({ page }) => {
    await page.goto('/remote.html');
    await expect(page.locator('#notice')).toBeVisible();
    await expect(page.locator('#status')).toHaveText('no session');
  });
});
