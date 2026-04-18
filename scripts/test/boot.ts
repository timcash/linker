import assert from 'node:assert/strict';

import {
  DAG_RANK_FANOUT_EDGE_COUNT,
  DAG_RANK_FANOUT_LAYOUT_FINGERPRINT,
  DAG_RANK_FANOUT_ROOT_WORKPLANE_ID,
  DAG_RANK_FANOUT_WORKPLANE_ORDER,
  getDagRankFanoutFocusLabelKey,
} from '../../src/data/dag-rank-fanout';
import {STAGE_ONBOARDING_COMPLETION_STORAGE_KEY} from '../../src/stage-config';
import {STORED_APP_SETTINGS_KEY} from '../../src/site-settings';
import {
  DEMO_LABEL_SET_ID,
  captureInteractionScreenshot,
  type BrowserTestContext,
  type ReadyResult,
  getCameraQueryState,
  getCanvasPixelSignature,
  getStageRouteState,
  openRoute,
  readAppResult,
  waitForBrowserUpdate,
} from './shared';

export async function runBootFlow(
  context: BrowserTestContext,
): Promise<ReadyResult | null> {
  const {page, pageErrors} = context;
  const route = context.url;
  const resetStorageScript = await page.evaluateOnNewDocument(
    ({onboardingKey, settingsKey}) => {
      window.localStorage.removeItem(onboardingKey);
      window.localStorage.removeItem(settingsKey);
    },
    {
      onboardingKey: STAGE_ONBOARDING_COMPLETION_STORAGE_KEY,
      settingsKey: STORED_APP_SETTINGS_KEY,
    },
  );

  try {
    await openRoute(page, route);
  } finally {
    await page.removeScriptToEvaluateOnNewDocument(
      (resetStorageScript as {identifier: string}).identifier,
    );
  }

  assert.deepEqual(
    pageErrors,
    [],
    `Boot flow should not capture unexpected browser errors: ${pageErrors.join('\n\n')}`,
  );

  const result = await readAppResult(page);

  assert.notEqual(
    result.state,
    'error',
    `App entered error state: ${'message' in result ? result.message : 'unknown error'}`,
  );

  if (result.state !== 'ready' || !('width' in result)) {
    context.addBrowserLog('test', 'App reached unsupported state.');
    assert.equal(result.state, 'unsupported', 'Expected either a ready or unsupported app state.');
    assert.match(result.message, /webgpu/i, 'Unsupported state should explain the WebGPU requirement.');
    return null;
  }

  assert.equal(result.width, result.innerWidth, 'Canvas should fill the viewport width.');
  assert.equal(result.height, result.innerHeight, 'Canvas should fill the viewport height.');
  assert.ok(
    result.canvasWidth >= result.width,
    'Canvas backing width should be at least as large as the visible width at boot.',
  );
  assert.ok(
    result.canvasHeight >= result.height,
    'Canvas backing height should be at least as large as the visible height at boot.',
  );
  assert.equal(result.stage.stageMode, '3d-mode', 'Default boot should start in DAG overview mode.');
  assert.equal(
    result.stage.planeCount,
    DAG_RANK_FANOUT_WORKPLANE_ORDER.length,
    'Default boot should start on the full twelve-workplane DAG dataset.',
  );
  assert.equal(
    result.stage.activeWorkplaneId,
    DAG_RANK_FANOUT_ROOT_WORKPLANE_ID,
    'Default boot should start on the DAG root workplane.',
  );
  assert.equal(
    result.stage.dagRootWorkplaneId,
    DAG_RANK_FANOUT_ROOT_WORKPLANE_ID,
    'Default boot should expose the DAG root workplane id.',
  );
  assert.equal(
    result.stage.dagNodeCount,
    DAG_RANK_FANOUT_WORKPLANE_ORDER.length,
    'Default boot should expose all twelve DAG workplanes.',
  );
  assert.equal(
    result.stage.dagEdgeCount,
    DAG_RANK_FANOUT_EDGE_COUNT,
    'Default boot should expose the authored dependency count.',
  );
  assert.equal(
    result.stage.dagLayoutFingerprint,
    DAG_RANK_FANOUT_LAYOUT_FINGERPRINT,
    'Default boot should keep the stable twelve-workplane layout fingerprint.',
  );
  assert.equal(
    result.stage.workplaneCanDelete,
    false,
    'Default boot should keep delete disabled because the root DAG workplane is not deletable.',
  );
  assert.equal(result.text.labelSetPreset, DEMO_LABEL_SET_ID, 'Default boot should use the demo label set.');
  assert.ok(result.text.glyphCount > 0, 'Default boot should generate glyph geometry.');
  assert.ok(result.text.visibleGlyphCount > 0, 'Default boot should render visible glyphs.');
  assert.equal(
    result.camera.label,
    getDagRankFanoutFocusLabelKey(DAG_RANK_FANOUT_ROOT_WORKPLANE_ID),
    'Default boot should keep the root workplane focus label active.',
  );
  assert.equal(
    result.stage.renderBridgeLinkCount,
    DAG_RANK_FANOUT_EDGE_COUNT,
    'Default boot should render the full DAG dependency set in 3d mode.',
  );
  assert.equal(
    result.stage.dagVisibleEdgeCount,
    DAG_RANK_FANOUT_EDGE_COUNT,
    'Default boot should expose the visible DAG edge count for the default overview.',
  );
  assert.equal(
    result.stage.dagFullWorkplaneCount +
      result.stage.dagLabelPointWorkplaneCount +
      result.stage.dagTitleOnlyWorkplaneCount +
      result.stage.dagGraphPointWorkplaneCount,
    result.stage.planeCount,
    'Default boot should account for every visible workplane in exactly one DAG LOD bucket.',
  );
  assert.equal(
    await isSelectionBoxVisible(context),
    false,
    'Default 3d boot should not show the plane-focus selection box.',
  );
  assert.deepEqual(
    await getCameraQueryState(page),
    {label: getDagRankFanoutFocusLabelKey(DAG_RANK_FANOUT_ROOT_WORKPLANE_ID)},
    'Default boot should mirror the focused label into the route.',
  );
  assert.deepEqual(
    await getStageRouteState(page),
    {stageMode: '3d-mode', workplaneId: DAG_RANK_FANOUT_ROOT_WORKPLANE_ID},
    'Default boot should mirror stage mode and workplane into the route.',
  );
  const pwaShell = await page.evaluate(() => ({
    appleCapable:
      document
        .querySelector('meta[name="apple-mobile-web-app-capable"]')
        ?.getAttribute('content') ?? '',
    iconHref: document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? '',
    manifestHref: document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? '',
    themeColor:
      document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '',
    viewport:
      document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
  }));
  assert.match(pwaShell.manifestHref, /site\.webmanifest/u, 'The app shell should advertise a web app manifest.');
  assert.match(pwaShell.iconHref, /linker-icon\.svg/u, 'The app shell should expose the shared SVG icon.');
  assert.equal(pwaShell.themeColor, '#000000', 'The app shell should keep the black PWA theme color.');
  assert.match(pwaShell.viewport, /viewport-fit=cover/u, 'The app shell should opt into mobile safe-area coverage.');
  assert.equal(pwaShell.appleCapable, 'yes', 'The app shell should opt into Apple standalone mode.');
  await assertEmbeddedSiteMenuInStatusPanel(context, 'Status');
  await page.waitForSelector('[data-site-menu-toggle]');
  await page.click('[data-site-menu-toggle]');
  await page.waitForSelector('[data-site-menu-overlay]:not([hidden])');
  const siteMenuState = await page.evaluate(() => ({
    breadcrumb:
      document.querySelector('[data-site-menu-breadcrumb]')?.textContent?.trim() ?? '',
    currentLabel:
      document.querySelector('[data-site-menu-link][aria-current="page"]')?.textContent?.trim() ?? '',
    labels: Array.from(document.querySelectorAll<HTMLElement>('[data-site-menu-link]')).map(
      (link) => link.textContent?.trim() ?? '',
    ),
  }));
  assert.match(siteMenuState.currentLabel, /App/i, 'The app route should mark itself in the shared fullscreen menu.');
  assert.match(siteMenuState.breadcrumb, /Menu \/ Navigation/u, 'The menu header should expose the navigation hierarchy.');
  assert.ok(siteMenuState.labels.some((label) => /Codex/i.test(label)), 'The shared fullscreen menu should include the codex route.');
  assert.ok(siteMenuState.labels.some((label) => /README/i.test(label)), 'The shared fullscreen menu should include the README route.');
  await page.click('[data-site-menu-page-target="settings"]');
  await page.waitForSelector('[data-site-menu-page="settings"]:not([hidden])');
  await page.waitForSelector('[data-site-menu-setting-button="ui-layout:wide"]');
  const settingsState = await page.evaluate(() => ({
    breadcrumb:
      document.querySelector('[data-site-menu-breadcrumb]')?.textContent?.trim() ?? '',
    labels: Array.from(document.querySelectorAll<HTMLElement>('[data-site-menu-setting-button]')).map(
      (button) => button.textContent?.trim() ?? '',
    ),
    note:
      document.querySelector<HTMLElement>('.site-menu-settings-note')?.textContent?.trim() ?? '',
    settingsSections: Array.from(document.querySelectorAll<HTMLElement>('[data-site-menu-settings-panel-target]')).map(
      (button) => button.textContent?.trim() ?? '',
    ),
  }));
  assert.match(settingsState.breadcrumb, /Menu \/ Settings \/ Layout/u, 'The settings view should expose the nested menu hierarchy.');
  assert.ok(settingsState.settingsSections.some((label) => /Layout/i.test(label)), 'The settings page should expose the layout section.');
  assert.ok(settingsState.settingsSections.some((label) => /View/i.test(label)), 'The settings page should expose the view section.');
  assert.ok(settingsState.settingsSections.some((label) => /Motion/i.test(label)), 'The settings page should expose the motion section.');
  assert.ok(settingsState.settingsSections.some((label) => /Install/i.test(label)), 'The settings page should expose the install section.');
  assert.ok(settingsState.labels.some((label) => /Compact/i.test(label)), 'The settings page should expose the compact layout option.');
  assert.ok(settingsState.labels.some((label) => /Wide/i.test(label)), 'The settings page should expose the wide layout option.');
  assert.ok(settingsState.labels.some((label) => /^2D$/i.test(label)), 'The settings page should expose a 2D stage preference.');
  assert.ok(settingsState.labels.some((label) => /^3D$/i.test(label)), 'The settings page should expose a 3D stage preference.');
  assert.ok(settingsState.labels.some((label) => /Sharp/i.test(label)), 'The settings page should expose the text style controls.');
  assert.ok(settingsState.labels.some((label) => /Orbit/i.test(label)), 'The settings page should expose the link style controls.');
  assert.ok(settingsState.labels.some((label) => /Smooth/i.test(label)), 'The settings page should expose the motion controls.');
  assert.ok(settingsState.labels.some((label) => /Reduced/i.test(label)), 'The settings page should expose reduced motion.');
  assert.ok(settingsState.labels.some((label) => /Auto/i.test(label)), 'The settings page should expose auto onboarding.');
  assert.ok(settingsState.labels.some((label) => /Skip/i.test(label)), 'The settings page should expose skip onboarding.');
  assert.match(settingsState.note, /apply/i, 'The settings page should explain that the app settings are persistent.');
  await page.click('[data-site-menu-setting-button="ui-layout:wide"]');
  await page.waitForFunction(() => document.body.dataset.appUiLayout === 'wide');
  await page.click('[data-site-menu-setting-button="ui-layout:compact"]');
  await page.waitForFunction(() => document.body.dataset.appUiLayout === 'compact');
  await page.click('[data-site-menu-settings-panel-target="motion"]');
  await page.waitForSelector('[data-site-menu-settings-panel="motion"]:not([hidden])');
  await page.click('[data-site-menu-setting-button="motion-preference:reduced"]');
  await page.waitForFunction(() => document.body.dataset.appMotionPreference === 'reduced');
  await page.click('[data-site-menu-setting-button="motion-preference:smooth"]');
  await page.waitForFunction(() => document.body.dataset.appMotionPreference === 'smooth');
  await page.click('[data-site-menu-settings-panel-target="install"]');
  await page.waitForSelector('[data-site-menu-settings-panel="install"]:not([hidden])');
  await page.waitForSelector('[data-site-menu-install-status]');
  await page.click('[data-site-menu-toggle]');
  await page.waitForSelector('[data-site-menu-overlay][hidden]');
  assert.equal(
    await page.evaluate(() => new URL(window.location.href).searchParams.get('demoPreset')),
    'dag-rank-fanout',
    'Default boot should persist the authored DAG preset into the route.',
  );
  await captureInteractionScreenshot(context, 'boot-ready');

  const initialSignature = await getCanvasPixelSignature(page);
  await openRoute(page, route);
  await waitForBrowserUpdate(page);
  assert.deepEqual(
    await getCanvasPixelSignature(page),
    initialSignature,
    'Reopening the same boot route should keep the render output stable.',
  );

  return result;
}

async function isSelectionBoxVisible(
  context: BrowserTestContext,
): Promise<boolean> {
  return context.page.evaluate(() => {
    const selectionBox = document.querySelector('[data-testid="selection-box"]');

    return (
      selectionBox instanceof HTMLElement &&
      !selectionBox.hidden &&
      window.getComputedStyle(selectionBox).display !== 'none'
    );
  });
}

async function assertEmbeddedSiteMenuInStatusPanel(
  context: BrowserTestContext,
  expectedPanelLabel: string,
): Promise<void> {
  const placement = await context.page.evaluate(() => {
    const statusPanel = document.querySelector<HTMLElement>('[data-testid="status-panel"]');
    const statusLabel = document.querySelector<HTMLElement>('[data-testid="status-panel-label"]');
    const menuSlot = document.querySelector<HTMLElement>('[data-testid="status-panel-menu-slot"]');
    const toggle = menuSlot?.querySelector<HTMLElement>('[data-site-menu-toggle]');
    const statusRect = statusPanel?.getBoundingClientRect();
    const menuSlotRect = menuSlot?.getBoundingClientRect();
    const toggleRect = toggle?.getBoundingClientRect();

    return {
      panelLabel: statusLabel?.textContent?.trim() ?? '',
      slotContainsToggle: menuSlot?.contains(toggle ?? null) ?? false,
      slotVisible:
        menuSlot instanceof HTMLElement &&
        menuSlot.getClientRects().length > 0 &&
        window.getComputedStyle(menuSlot).display !== 'none' &&
        window.getComputedStyle(menuSlot).visibility !== 'hidden',
      toggleVisible:
        toggle instanceof HTMLElement &&
        toggle.getClientRects().length > 0 &&
        window.getComputedStyle(toggle).display !== 'none' &&
        window.getComputedStyle(toggle).visibility !== 'hidden',
      toggleRightGap: Math.round((statusRect?.right ?? 0) - (toggleRect?.right ?? 0)),
      toggleTopGap: Math.round((toggleRect?.top ?? 0) - (statusRect?.top ?? 0)),
      toggleWithinSlot:
        !!toggleRect &&
        !!menuSlotRect &&
        toggleRect.left >= menuSlotRect.left - 1 &&
        toggleRect.right <= menuSlotRect.right + 1 &&
        toggleRect.top >= menuSlotRect.top - 1 &&
        toggleRect.bottom <= menuSlotRect.bottom + 1,
    };
  });

  assert.equal(
    placement.panelLabel,
    expectedPanelLabel,
    `The status shell should label the top panel as ${expectedPanelLabel}.`,
  );
  assert.equal(
    placement.slotContainsToggle,
    true,
    'The site menu toggle should be mounted inside the dedicated status-panel menu slot.',
  );
  assert.equal(
    placement.slotVisible,
    true,
    'The status-panel menu slot should stay visible.',
  );
  assert.equal(
    placement.toggleVisible,
    true,
    'The site menu toggle should stay visible inside the top panel.',
  );
  assert.equal(
    placement.toggleWithinSlot,
    true,
    'The site menu toggle should stay fully contained by the top-right status-panel menu slot.',
  );
  assert.ok(
    placement.toggleRightGap >= 0 && placement.toggleRightGap <= 20,
    `The site menu toggle should stay visually aligned to the right edge of the top panel. placement=${JSON.stringify(placement)}`,
  );
  assert.ok(
    placement.toggleTopGap >= 0 && placement.toggleTopGap <= 20,
    `The site menu toggle should stay visually aligned to the top edge of the top panel. placement=${JSON.stringify(placement)}`,
  );
}
