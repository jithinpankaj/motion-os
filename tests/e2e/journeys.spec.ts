import { test, expect, type Page } from '@playwright/test';

// Local seed credentials (see server/seed.ts). Never used outside development.
const PASSWORD = 'motion-os-demo';
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible();
}

test('navigation adapts to permissions', async ({ page }) => {
  await login(page, 'mia@motion.os');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Explore' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Motion Studio' })).toHaveCount(0);
});

test('Journey B: marketing customises a template and exports a valid MP4', async ({ page }) => {
  await login(page, 'mia@motion.os');
  await page.goto('/explore?channel=instagram-story');
  await page.getByRole('button', { name: 'Open Aurora Flow' }).click();
  await expect(page).toHaveURL(/\/play\//);
  const headline = page.locator('#param-headline');
  await headline.fill('Spring\nLight');
  await page.getByRole('radio', { name: 'Dusk' }).click();
  await expect(page.getByText('locked').first()).toBeVisible();
  await page.getByRole('button', { name: 'Export' }).first().click();
  const dur = page.getByRole('textbox', { name: 'Duration', exact: true });
  await dur.fill('2');
  await dur.press('Enter');
  await page.getByRole('button', { name: /Export MP4/ }).click();
  const tray = page.getByLabel('Export queue');
  await expect(tray.getByText('completed')).toBeVisible({ timeout: 60_000 });
  const info = await page.evaluate(async () => {
    const s = await fetch('/api/session').then((r) => r.json());
    const jobs = (await fetch('/api/exports', { headers: { 'x-workspace-id': s.workspaces[0].id } }).then((r) => r.json())).jobs;
    const j = jobs.find((x: any) => x.format === 'mp4' && x.status === 'completed');
    const v = document.createElement('video');
    v.muted = true; v.src = j.result.url;
    await new Promise((r) => (v.onloadeddata = r));
    v.currentTime = 1.8; await new Promise((r) => (v.onseeked = r));
    const c = new OffscreenCanvas(108, 192); const x = c.getContext('2d')!; x.drawImage(v, 0, 0, 108, 192);
    const px = x.getImageData(0, 0, 108, 192).data; let max = 0;
    for (let i = 0; i < px.length; i += 4) max = Math.max(max, Math.min(px[i], px[i + 1], px[i + 2]));
    return { w: v.videoWidth, h: v.videoHeight, d: v.duration, expected: j.settings.duration * j.settings.loops, brightest: max };
  });
  expect(info).toMatchObject({ w: 1080, h: 1920 });
  expect(info.d).toBeCloseTo(info.expected, 1);
  expect(info.brightest).toBeGreaterThan(200); // headline text present in the encoded frame
});

test('Studio: playback continues while editing and the scene autosaves', async ({ page }) => {
  await login(page, 'dana@motion.os');
  await page.goto('/studio');
  await page.getByRole('button', { name: 'Open Kinetic Typography' }).click();
  await page.getByRole('treeitem').filter({ hasText: 'Headline' }).click();
  const t0 = await page.locator('.tl-time').textContent();
  await page.getByLabel('Text content').fill('FLOW');
  await page.waitForTimeout(600);
  expect(await page.locator('.tl-time').textContent()).not.toBe(t0);
  await expect(page.locator('.save-pill')).toHaveText('Saved', { timeout: 8000 });
  await page.reload();
  await page.getByRole('treeitem').filter({ hasText: 'Headline' }).click();
  await expect(page.getByLabel('Text content')).toHaveValue('FLOW');
});

test.describe('visual regression', () => {
  for (const name of ['Aurora Flow', 'Liquid Mesh', 'Organic Blobs', 'Particle Field', 'Kinetic Typography']) {
    test(`${name} renders deterministically`, async ({ page }) => {
      await login(page, 'dana@motion.os');
      const png = await page.evaluate(async (presetName) => {
        // Modules are served by the Vite dev server; imported by URL inside the page.
        const load = (u: string): Promise<any> => import(u);
        const { GPUContext } = await load('/src/engine/gpu.ts');
        const { SceneRenderer } = await load('/src/engine/renderer.ts');
        const presets = await load('/shared/scene/presets.ts');
        const { nullResolver } = await load('/src/engine/assets.ts');
        const build = presets.LAUNCH_PRESETS.find((p: any) => p.build().meta.name === presetName)!.build;
        const doc = build('scn_visual');
        const c = new OffscreenCanvas(432, 540);
        const gpu = new GPUContext(c, { preserveDrawingBuffer: true });
        gpu.renderer.setSize(432, 540, false);
        const r = new SceneRenderer(gpu, nullResolver);
        r.setScene(doc);
        await r.ready(3);
        r.render(3, { x: 0, y: 0, w: 432, h: 540 });
        const blob = await c.convertToBlob({ type: 'image/png' });
        const url: string = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(blob); });
        gpu.dispose();
        return url.split(',')[1];
      }, name);
      expect(Buffer.from(png, 'base64')).toMatchSnapshot(`${name.toLowerCase().replace(/\W+/g, '-')}.png`, { maxDiffPixelRatio: 0.03 });
    });
  }
});
