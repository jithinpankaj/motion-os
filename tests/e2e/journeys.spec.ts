import { test, expect, type Page } from '@playwright/test';

// Local seed credentials (see server/seed.ts). Never used outside development.
const PASSWORD = 'motion-os-demo';
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/what are we animating\?/)).toBeVisible();
}

test('navigation is simple and adapts to permissions', async ({ page }) => {
  await login(page, 'mia@motion.os');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const name of ['Home', 'Community']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New file' })).toBeVisible();
  await page.context().clearCookies();
  await login(page, 'eli@motion.os');
  await expect(page.getByRole('button', { name: 'New file' })).toHaveCount(0);
});

const openFile = async (page: Page, name: string) => {
  const id = await page.evaluate(async (n) => {
    const s = await fetch('/api/session').then((r) => r.json());
    const p = (await fetch('/api/projects', { headers: { 'x-workspace-id': s.workspaces[0].id } }).then((r) => r.json())).projects;
    return p.find((x: any) => x.name === n).id;
  }, name);
  await page.goto(`/edit/${id}`);
  await expect(page.getByRole('navigation', { name: 'Editor mode' })).toBeVisible();
};

test('Editor: design, animate, interact and try a toggle switch', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await login(page, 'dana@motion.os');
  // A fresh copy of the preset each run, so the test never depends on earlier edits.
  const id = await page.evaluate(async () => {
    const s = await fetch('/api/session').then((r) => r.json());
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': s.workspaces[0].id }, body: JSON.stringify({ name: 'E2E toggle', preset: 'toggle-switch' }) }).then((x) => x.json());
    return r.id;
  });
  await page.goto(`/edit/${id}`);
  // Try it: clicking the switch on the canvas flips the "On" control.
  await page.getByRole('button', { name: 'Try it' }).click();
  const box = await page.locator('.stage-box').boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.getByRole('switch', { name: 'On' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.log')).toContainText('Turn on');
  // Design: add a star; Animate: give it a one-click Spin, which becomes its own move.
  await page.getByRole('button', { name: 'Design' }).click();
  await page.locator('.tool', { hasText: 'Star' }).click();
  await expect(page.locator('.layer-row[aria-selected="true"]')).toContainText('Star');
  await page.getByRole('button', { name: 'Animate' }).click();
  await page.locator('.move', { hasText: 'Spin' }).click();
  await expect(page.locator('.tl-head .chip[aria-pressed="true"]')).toContainText('Star · Spin');
  // Interact: a hover recipe adds two readable rules.
  await page.getByRole('button', { name: 'Interact' }).click();
  await page.locator('.move', { hasText: 'Hover effect' }).click();
  await page.locator('.modal select').first().selectOption({ label: 'Star' });
  await page.locator('.modal select').nth(1).selectOption({ index: (await page.locator('.modal select').nth(1).locator('option').count()) - 1 });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.rule').filter({ hasText: 'hovers over' }).first()).toBeVisible();
  await expect(page.locator('.ed-top')).toContainText('All changes saved', { timeout: 8000 });
  await page.reload();
  await page.getByRole('button', { name: 'Interact' }).click();
  await expect(page.locator('.rule').filter({ hasText: 'hovers over' }).first()).toBeVisible();
});

test('Community: try the curious buddy, then remix it', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await login(page, 'mia@motion.os');
  await page.goto('/community?sort=presets');
  await page.getByRole('button', { name: /Curious buddy/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Curious buddy' })).toBeVisible();
  await expect(page.locator('.widget', { hasText: 'Look X' })).toContainText('Follows the pointer');
  await page.mouse.move(10, 10);
  await page.mouse.move(1300, 800, { steps: 8 });
  await page.getByRole('button', { name: 'Press' }).click();
  await expect(page.locator('.log')).toContainText('Happy jump');
  await page.getByRole('button', { name: /Remix into my files/ }).click();
  await expect(page).toHaveURL(/\/edit\/prj_/);
  await expect(page.locator('.ed-top')).toContainText('Curious buddy remix');
});

test('Export: one move as MP4 at the file size', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await login(page, 'dana@motion.os');
  await openFile(page, 'Day & night');
  const started = new Date().toISOString();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('.modal').getByRole('button', { name: 'Export', exact: true }).click();
  const latest = () => page.evaluate(async (since) => {
    const s = await fetch('/api/session').then((r) => r.json());
    const jobs = (await fetch('/api/exports', { headers: { 'x-workspace-id': s.workspaces[0].id } }).then((r) => r.json())).jobs;
    return jobs.find((x: any) => x.format === 'mp4' && x.createdAt >= since) ?? null;
  }, started);
  await expect.poll(async () => (await latest())?.status, { timeout: 60_000 }).toBe('completed');
  const job = await latest();
  const info = await page.evaluate(async (j) => {
    const v = document.createElement('video');
    v.muted = true; v.src = j.result.url;
    await new Promise((r) => (v.onloadedmetadata = r));
    return { w: v.videoWidth, h: v.videoHeight, d: v.duration };
  }, job);
  expect(info).toMatchObject({ w: 1080, h: 1080 });
  expect(info.d).toBeCloseTo(1.6, 1); // the "Sunset" move
});

test.describe('visual regression', () => {
  for (const name of ['Aurora Flow', 'Liquid Mesh', 'Organic Blobs', 'Particle Field', 'Kinetic Typography', 'Curious buddy', 'Traffic light']) {
    test(`${name} renders deterministically`, async ({ page }) => {
      await login(page, 'dana@motion.os');
      const png = await page.evaluate(async (presetName) => {
        // Modules are served by the Vite dev server; imported by URL inside the page.
        const load = (u: string): Promise<any> => import(u);
        const { GPUContext } = await load('/src/engine/gpu.ts');
        const { SceneRenderer } = await load('/src/engine/renderer.ts');
        const presets = await load('/shared/scene/presets.ts');
        const motion = await load('/shared/motion/presets.ts');
        const { nullResolver } = await load('/src/engine/assets.ts');
        // Effect presets render their timeline; interactive presets render their designed resting state.
        const fx = presets.LAUNCH_PRESETS.find((p: any) => p.build().meta.name === presetName);
        const doc = fx ? fx.build('scn_visual') : motion.MOTION_PRESETS.find((p: any) => p.name === presetName).build();
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
