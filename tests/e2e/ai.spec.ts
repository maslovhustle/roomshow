import { expect, test } from '@playwright/test';
import { STYLE_PROMPTS } from '../../src/prompts';

const UNREACHABLE = 'ws://127.0.0.1:59999';

/**
 * An explicit null, not an empty string or an absent key: both of those mean
 * "use whatever the build ships with", and the build usually ships with a real
 * endpoint. Only null states the unconfigured case, so these tests read the
 * same on a laptop with a pod running and on CI with none.
 */
const NO_ENGINE = { transport: 'local', diffusionUrl: null };

test.describe('the AI engine', () => {
  test('stays out of the way when no endpoint is configured', async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('roomshow.config', JSON.stringify(cfg));
    }, NO_ENGINE);
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

  // Offering a button that snaps back two seconds later reads as a broken
  // button, not as a missing endpoint — so the remote refuses the tap and says
  // why instead.
  test('refuses the AI engine, with a reason, when the stage has none', async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('roomshow.config', JSON.stringify(cfg));
    }, NO_ENGINE);
    await page.goto('/remote.html?code=PROM');

    await expect(page.locator('[data-engine="ai"]')).toBeDisabled();
    await expect(page.locator('#notice')).toContainText(/no AI endpoint/i);
    await expect(page.locator('#aiPanel')).toBeHidden();
  });

  test('offers every style once a stage reports an engine', async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('roomshow.config', JSON.stringify(cfg));
    }, NO_ENGINE);
    await page.goto('/remote.html?code=PROM');

    // A stand-in for the stage rather than a real one.
    //
    // The remote learns the engine exists only from a broadcast state, and a
    // real stage pointed at an unreachable endpoint only passes through
    // `connecting` on its way to `offline`. Catching that window is a race —
    // it held on a laptop and lost in CI.
    //
    // The stub owns the state the way the stage does: it answers `hello`, and
    // it applies a patch and rebroadcasts the result. Repeating a fixed state
    // on a timer instead would keep overwriting the engine the operator just
    // picked, which is its own race and cost a second red build.
    await page.evaluate(() => {
      const channel = new BroadcastChannel('roomshow:PROM');
      const state: Record<string, unknown> = {
        engine: 'shader',
        aiStatus: 'live',
        aiDetail: '',
        prompt: '',
        aiStrength: 0.35,
        preset: 'comic',
        intensity: 0.65,
        source: 'shapes',
        mirror: 0,
        audio: false,
        recording: false,
      };
      const announce = () =>
        channel.postMessage({ t: 'state', from: 'stage', at: Date.now(), state: { ...state } });
      channel.onmessage = (event: MessageEvent) => {
        const message = event.data as { t?: string; patch?: Record<string, unknown> };
        if (message.t === 'patch') Object.assign(state, message.patch);
        if (message.t === 'patch' || message.t === 'hello') announce();
      };
      announce();
    });

    const ai = page.locator('[data-engine="ai"]');
    await expect(ai).toBeEnabled({ timeout: 20_000 });
    await ai.click();
    await expect(page.locator('#aiPanel')).toBeVisible();
    await expect(page.locator('#styles button')).toHaveCount(STYLE_PROMPTS.length);

    await page.locator('#styles button').first().click();
    await expect(page.locator('#prompt')).toHaveValue(/cel animation/);
  });
});
