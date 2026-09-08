import { expect, test } from '@playwright/test';
import { BANKS, PRESETS } from '../../src/presets';

test.describe('the look gallery', () => {
  test('lists every look', async ({ page }) => {
    await page.goto('/explore.html');
    // Counted from the data, not written down: a hardcoded number turns every
    // new look into a failing test that says nothing about what broke.
    await expect(page.locator('#count')).toHaveText(`${PRESETS.length} looks`);
    await expect(page.locator('.tile')).toHaveCount(PRESETS.length);
  });

  // The filter once updated the count while the grid ignored it, because a
  // class rule outranked the user-agent style for [hidden].
  test('actually hides the tiles it filters out', async ({ page }) => {
    await page.goto('/explore.html');
    const medium = BANKS.find((bank) => bank.id === 'medium')!;
    await page.locator('.bank[data-bank="medium"]').click();
    await expect(page.locator('#count')).toHaveText(`${medium.looks.length} looks`);
    await expect(page.locator('.tile:visible')).toHaveCount(medium.looks.length);
  });

  test('paints previews rather than leaving empty canvases', async ({ page }) => {
    await page.goto('/explore.html');
    await page.locator('.bank[data-bank="film"]').click();

    await expect.poll(async () => page.evaluate(() => {
      const tiles = [...document.querySelectorAll<HTMLElement>('.tile')]
        .filter((tile) => tile.offsetParent !== null);
      let painted = 0;
      for (const tile of tiles) {
        const canvas = tile.querySelector('canvas') as HTMLCanvasElement | null;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) continue;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.length; i += 4) {
          if (data[i]! + data[i + 1]! + data[i + 2]! > 24) { painted++; break; }
        }
      }
      return painted;
    }), { timeout: 40_000 }).toBeGreaterThanOrEqual(4);
  });

  test('sends a tile into the stage with that look selected', async ({ page }) => {
    await page.goto('/explore.html');
    await expect(page.locator('.tile').first()).toBeVisible();
    await expect(page.locator('.tile').first()).toHaveAttribute(
      'href',
      `stage.html?look=${PRESETS[0]!.id}`,
    );
  });
});

test.describe('the landing page', () => {
  test('offers a session and a way into the gallery', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#code')).toHaveValue(/^[0-9A-Z]{4}$/);
    await expect(page.locator('.explore-link')).toBeVisible();
  });

  test('carries the code into the stage', async ({ page }) => {
    await page.goto('/');
    await page.locator('#code').fill('WXYZ');
    await page.locator('#openStage').click();
    await expect(page).toHaveURL(/stage\.html\?code=WXYZ/);
  });
});
