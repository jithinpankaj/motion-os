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

/** A fresh copy of a library component each run, so tests never depend on earlier edits. */
const freshFile = (page: Page, preset: string, name: string): Promise<string> => page.evaluate(async ([preset, name]) => {
  const s = await fetch('/api/session').then((r) => r.json());
  const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': s.workspaces[0].id }, body: JSON.stringify({ name, preset }) }).then((x) => x.json());
  return r.id;
}, [preset, name]);

test('Editor: try the living button, then design, animate and interact', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await login(page, 'dana@motion.os');
  // A fresh copy of the component each run, so the test never depends on earlier edits.
  await page.goto(`/edit/${await freshFile(page, 'living-button', 'E2E button')}`);
  // Try it: the controls show straight away; hovering and clicking the button runs its states.
  await page.getByRole('button', { name: 'Try it' }).click();
  await expect(page.getByRole('switch', { name: 'Hovered' })).toBeVisible();
  const box = await page.locator('.stage-box').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height * 0.55, { steps: 4 });
  await expect(page.getByRole('switch', { name: 'Hovered' })).toHaveAttribute('aria-checked', 'true');
  await page.mouse.down();
  await expect(page.locator('.log')).toContainText('Press');
  await page.mouse.up();
  await expect(page.locator('.log')).toContainText('Release');
  // Customise recolours every part that uses the colour.
  await expect(page.locator('.ed-right')).toContainText('Button colour');
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
  // A rule can play a sound: pick "play a sound" and a built-in sound appears.
  const lastRule = page.locator('.rule').last();
  await lastRule.getByRole('combobox', { name: 'Do' }).last().selectOption('sound');
  await expect(lastRule.getByRole('combobox', { name: 'Sound' })).toHaveValue('pop');
  await expect(page.locator('.ed-top')).toContainText('All changes saved', { timeout: 8000 });
  // "Add to Community" asks for a library category, pre-filled from the file.
  await page.getByRole('button', { name: 'Add to Community' }).click();
  await expect(page.locator('.modal').getByRole('combobox', { name: 'Category' })).toHaveValue('Interactive UI');
  await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Interact' }).click();
  await expect(page.locator('.rule').filter({ hasText: 'hovers over' }).first()).toBeVisible();
});

test('Community: try the living button, then remix it', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await login(page, 'mia@motion.os');
  await page.goto('/community?sort=presets');
  // Categories filter the library.
  await page.getByRole('group', { name: 'Categories' }).getByRole('button', { name: 'Characters' }).click();
  await expect(page.getByRole('button', { name: /Mochi/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Living button/ })).toHaveCount(0);
  await page.getByRole('group', { name: 'Categories' }).getByRole('button', { name: 'Interactive UI' }).click();
  await page.getByRole('button', { name: /Living button/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Living button' })).toBeVisible();
  await page.getByRole('switch', { name: 'Held' }).click();
  await expect(page.locator('.log')).toContainText('Press');
  await page.getByRole('switch', { name: 'Held' }).click();
  await expect(page.locator('.log')).toContainText('Unhover');
  await page.getByRole('button', { name: /Remix into my files/ }).click();
  await expect(page).toHaveURL(/\/edit\/prj_/);
  await expect(page.locator('.ed-top')).toContainText('Living button remix');
});

test('Export: one move as MP4 at the file size', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await login(page, 'dana@motion.os');
  await page.goto(`/edit/${await freshFile(page, 'living-button', 'E2E export')}`);
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
  expect(info.d).toBeCloseTo(10, 1); // the 5 s "Idle" loop, exported as two cycles
});

test.describe('visual regression', () => {
  for (const name of ['Aurora Flow', 'Liquid Mesh', 'Organic Blobs', 'Particle Field', 'Kinetic Typography', 'Living button']) {
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
