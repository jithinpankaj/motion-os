import { test, expect, type Page } from '@playwright/test';

// Local seed credentials (see server/seed.ts). Never used outside development.
const PASSWORD = 'motion-os-demo';
async function login(page: Page, email: string, opts: { tour?: boolean } = {}) {
  // Most tests skip the first-visit tour; the onboarding test sees it.
  if (!opts.tour) await page.addInitScript(() => { try { localStorage.setItem('mos.tour.v1', 'done'); } catch { /* ignore */ } });
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole("heading", { name: /animating today/ })).toBeVisible();
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
  // Try it: hovering and pressing the button moves it between its states; the debugger says what ran.
  await page.getByRole('button', { name: 'Try it' }).click();
  const box = await page.locator('.stage-box').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height * 0.55, { steps: 4 });
  await expect(page.locator('.dbg-state')).toContainText('Hover');
  await page.mouse.down();
  await expect(page.locator('.dbg-state')).toContainText('Pressed');
  await page.mouse.up();
  await expect(page.locator('.dbg-state')).toContainText('Hover');
  await expect(page.locator('.dbg')).toContainText('Released ran.');
  // Customise recolours every part that uses the colour.
  await expect(page.locator('.ed-right')).toContainText('Button colour');
  // Design: add a star; Animate: give it a one-click Spin, which becomes its own move.
  await page.getByRole('button', { name: 'Design' }).click();
  await page.locator('.tool', { hasText: 'Star' }).click();
  await expect(page.locator('.layer-row[aria-selected="true"]')).toContainText('Star');
  await page.getByRole('button', { name: 'Animate' }).click();
  await page.locator('.move', { hasText: 'Spin' }).click();
  await expect(page.locator('.tl-head .chip[aria-pressed="true"]')).toContainText('Star · Spin');
  // Interact: the helper asks three plain questions and writes two readable interactions.
  await page.getByRole('button', { name: 'Interact' }).click();
  await page.getByRole('button', { name: 'New interaction' }).click();
  await page.locator('.tile', { hasText: 'hovers over' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('.pick-item', { hasText: /^Star$/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('.tile', { hasText: 'Play a move' }).first().click();
  await page.locator('.modal select').selectOption({ label: 'Star · Spin' });
  await expect(page.locator('.wiz-preview')).toContainText('When someone hovers over Star');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.icard', { hasText: 'hovers over Star' })).toHaveCount(1);
  await expect(page.locator('.icard', { hasText: 'moves off Star' })).toHaveCount(1); // the "undo it" pair
  // The Living button's "Released" interaction: open it and add a sound step.
  await page.locator('.icard-sentence', { hasText: 'lets go of' }).click();
  await page.locator('.icard.open').getByRole('combobox', { name: 'Add action' }).selectOption('sound');
  await expect(page.locator('.icard.open').getByRole('combobox', { name: 'Sound' }).last()).toHaveValue('pop');
  await expect(page.locator('.ed-top')).toContainText('All changes saved', { timeout: 8000 });
  // "Add to Community" asks for a library category, pre-filled from the file.
  await page.getByRole('button', { name: 'Add to Community' }).click();
  await expect(page.locator('.modal').getByRole('combobox', { name: 'Category' })).toHaveValue('Interactive UI');
  await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Interact' }).click();
  await expect(page.locator('.icard', { hasText: 'hovers over Star' })).toHaveCount(1);
});

test('Interactions: a beginner builds one in plain words, then changes a word and adds a condition', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'dana@motion.os');
  await page.goto(`/edit/${await freshFile(page, 'bouncy-headline', 'E2E simple')}`);
  await page.getByRole('button', { name: 'Interact' }).click();
  // "When someone clicks anywhere → play Jump, then back next time" — three questions, no jargon.
  await page.getByRole('button', { name: 'New interaction' }).click();
  await page.locator('.tile', { hasText: 'clicks' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('.pick-item', { hasText: 'Anywhere on the canvas' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('.tile', { hasText: 'Play it, then back next time' }).click();
  await page.locator('.modal select').selectOption({ label: 'Jump' });
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.icard.open')).toContainText('When someone clicks anywhere');
  await expect(page.locator('.icard', { hasText: 'Jump on turns on' })).toHaveCount(1); // the switch it remembers with
  // Click a word to change it: clicks → presses a key (Enter).
  await page.locator('.icard.open .tok', { hasText: 'clicks' }).click();
  await page.locator('.pick-item', { hasText: 'presses a key' }).click();
  await expect(page.locator('.icard.open')).toContainText('presses the Enter key');
  // "Only if…" and "More options" stay out of the way until asked for.
  await page.locator('.icard.open').getByRole('button', { name: 'Only if…' }).click();
  await expect(page.locator('.icard.open .cond-row')).toHaveCount(1);
  await page.locator('.icard.open').getByRole('button', { name: 'Remove', exact: true }).click();
  await page.locator('.icard.open details.more > summary').first().click();
  await page.locator('.icard.open').getByLabel('If it happens again while still running').selectOption('ignore');
  await expect(page.locator('.ed-top')).toContainText('All changes saved', { timeout: 8000 });
  // Try it: Enter plays it; the debugger says so in a sentence.
  await page.reload();
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.locator('.stage-box').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Enter');
  await expect(page.locator('.dbg')).toContainText('ran.');
  await expect(page.locator('.log, .dbg')).toContainText('Jump');
});

test('New users: the Learn page, the editor tour, and Ask Claude', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'mia@motion.os', { tour: true });
  await expect(page.locator('.learn-banner')).toContainText('New here?');
  await page.getByRole('link', { name: 'Show me how' }).click();
  await expect(page.getByRole('heading', { name: /Make things move/ })).toBeVisible();
  await expect(page.locator('.learn-steps .learn-step')).toHaveCount(4);
  // The starter opens with the tour: a spotlight walks through the editor step by step.
  await page.getByRole('button', { name: 'Open a starter and take the tour' }).click();
  await expect(page.getByRole('dialog', { name: /Tour step 1 of 7/ })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: /Tour step 2 of 7: Four steps/ })).toBeVisible();
  await expect(page.locator('.tour-spot')).toBeVisible();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Start making' }).click();
  await expect(page.locator('.tour')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.tour')).toHaveCount(0); // seen once, not again…
  await page.getByRole('button', { name: 'Show the tour' }).click();
  await expect(page.locator('.tour')).toHaveCount(1); // …unless asked for
  await page.getByRole('button', { name: 'Skip' }).click();
  // Ask Claude opens with ideas that use this file's names. Without an API key the server says so plainly.
  await page.getByRole('button', { name: 'Ask Claude' }).click();
  await expect(page.locator('.ask')).toBeVisible();
  await expect(page.locator('.ask-idea').first()).toContainText('the button');
  const status = await page.evaluate(async () => { const s = await fetch('/api/session').then((r) => r.json()); return (await fetch('/api/assistant/status', { headers: { 'x-workspace-id': s.workspaces[0].id } }).then((r) => r.json())).configured; });
  if (!status) await expect(page.locator('.ask-note')).toContainText('Claude isn’t connected on this server yet');
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
  await page.waitForTimeout(800); // let the page transition settle before measuring the canvas
  const stage = await page.locator('[aria-label*="interactive preview"]').first().boundingBox();
  await page.mouse.move(stage!.x + stage!.width / 2, stage!.y + stage!.height * 0.55, { steps: 4 });
  await expect(page.locator('.log')).toContainText('◆ Hover');
  await page.mouse.down(); await page.mouse.up();
  await expect(page.locator('.log')).toContainText('Release');
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
