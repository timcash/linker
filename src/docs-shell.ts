import {LINE_STRATEGY_OPTIONS, type LineStrategy} from './line/types';
import {getPwaInstallState, promptForPwaInstall, subscribePwaInstallState} from './pwa';
import type {StageMode} from './plane-stack';
import {
  APP_MOTION_PREFERENCE_OPTIONS,
  APP_ONBOARDING_PREFERENCE_OPTIONS,
  APP_STAGE_MODE_OPTIONS,
  APP_UI_LAYOUT_OPTIONS,
  readStoredAppSettings,
  subscribeStoredAppSettings,
  type AppMotionPreference,
  type AppOnboardingPreference,
  type AppUiLayout,
  type StoredAppSettings,
  writeStoredAppSettings,
} from './site-settings';
import {readConfiguredRepoUrl, resolveConfiguredRepoUrl} from './remote-config';
import {TEXT_STRATEGY_OPTIONS, type TextStrategy} from './text/types';

export type DocsRoute = 'app' | 'auth' | 'codex' | 'logs' | 'new-user' | 'readme' | 'tasks';

type SiteMenuPage = 'nav' | 'settings';
type SiteMenuPlacement = 'embedded' | 'floating';
type SiteMenuSettingsPanel = 'install' | 'layout' | 'motion' | 'view';

type SiteMenuOptions = {
  onSettingsChange?: (settings: StoredAppSettings) => void;
  placement?: SiteMenuPlacement;
};

type SettingChoice<T extends string> = {
  label: string;
  value: T;
};

type SettingGroupHandle = {
  element: HTMLElement;
  sync: () => void;
};

let siteMenuIdCounter = 0;

export type SiteMenuHandle = {
  close: () => void;
  destroy: () => void;
  element: HTMLElement;
  open: () => void;
};

export function createSiteMenu(
  activeRoute: DocsRoute,
  options: SiteMenuOptions = {},
): SiteMenuHandle {
  const placement = options.placement ?? 'floating';
  const menuId = `site-menu-${activeRoute}-${++siteMenuIdCounter}`;
  let currentSettings = readStoredAppSettings();
  let activePage: SiteMenuPage = 'nav';
  let activeSettingsPanel: SiteMenuSettingsPanel = 'layout';
  const resolveCurrentRepoUrl = (): string =>
    resolveConfiguredRepoUrl({
      configuredUrl: import.meta.env.VITE_LINKER_REPO_URL as string | undefined,
      storedUrl: currentSettings.repoUrl,
    });
  const siteMenuEntries = buildSiteMenuEntries(resolveCurrentRepoUrl());
  let repoMenuLink: HTMLAnchorElement | null = null;

  const root = document.createElement('section');
  root.className = `site-menu-root site-menu-root--${placement}`;
  root.dataset.activeRoute = activeRoute;

  const bar = document.createElement('header');
  bar.className = 'site-menu-bar';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'site-menu-toggle';
  toggle.dataset.siteMenuToggle = 'true';
  toggle.setAttribute('aria-controls', menuId);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-haspopup', 'dialog');
  toggle.textContent = 'Menu';
  bar.append(toggle);

  const overlay = document.createElement('section');
  overlay.className = 'site-menu-overlay';
  overlay.dataset.siteMenuOverlay = 'true';
  overlay.hidden = true;
  overlay.id = menuId;
  overlay.setAttribute('aria-label', 'Linker menu');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('role', 'dialog');

  const shell = document.createElement('section');
  shell.className = 'site-menu-shell';

  const shellHeader = document.createElement('header');
  shellHeader.className = 'site-menu-shell-header';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'site-menu-eyebrow';
  eyebrow.textContent = 'Linker';

  const breadcrumb = document.createElement('p');
  breadcrumb.className = 'site-menu-breadcrumb';
  breadcrumb.dataset.siteMenuBreadcrumb = 'true';

  const title = document.createElement('h2');
  title.className = 'site-menu-title';

  const copy = document.createElement('p');
  copy.className = 'site-menu-copy';

  const pageTabs = document.createElement('nav');
  pageTabs.className = 'site-menu-page-tabs';
  pageTabs.setAttribute('aria-label', 'Menu pages');

  const navPageButton = createSiteMenuPageButton('Navigation', 'nav');
  const settingsPageButton = createSiteMenuPageButton('Settings', 'settings');
  pageTabs.append(navPageButton, settingsPageButton);

  shellHeader.append(eyebrow, breadcrumb, title, copy, pageTabs);

  const navPage = document.createElement('section');
  navPage.className = 'site-menu-page';
  navPage.dataset.siteMenuPage = 'nav';

  const routesNav = document.createElement('nav');
  routesNav.className = 'site-menu-nav';
  routesNav.setAttribute('aria-label', 'Linker routes');

  const list = document.createElement('ul');
  list.className = 'site-menu-list';

  for (const entry of siteMenuEntries) {
    const item = document.createElement('li');
    item.className = 'site-menu-item';

    const link = document.createElement('a');
    link.className = 'site-menu-link';
    link.dataset.siteMenuLink = entry.label;
    link.href = entry.route === null ? entry.href : resolveSiteHref(entry.href);

    if (entry.route === activeRoute) {
      link.setAttribute('aria-current', 'page');
    }

    if (entry.route === null) {
      link.target = '_blank';
      link.rel = 'noreferrer';
      if (entry.label === 'GitHub') {
        repoMenuLink = link;
      }
    }

    const label = document.createElement('span');
    label.className = 'site-menu-link-label';
    label.textContent = entry.label;

    const meta = document.createElement('span');
    meta.className = 'site-menu-link-meta';
    meta.textContent =
      entry.route === null ? 'External' : entry.route === activeRoute ? 'Current' : 'Open';

    link.append(label, meta);
    item.append(link);
    list.append(item);
  }

  routesNav.append(list);
  navPage.append(routesNav);

  const settingsPage = document.createElement('section');
  settingsPage.className = 'site-menu-page';
  settingsPage.dataset.siteMenuPage = 'settings';
  settingsPage.hidden = true;

  const settingsIntro = document.createElement('p');
  settingsIntro.className = 'site-menu-settings-note';
  settingsIntro.textContent =
    activeRoute === 'app'
      ? 'Settings save instantly and apply here right away when the route supports it.'
      : 'Settings save instantly and carry over to the next App session.';

  const settingsSectionNav = document.createElement('nav');
  settingsSectionNav.className = 'site-menu-settings-sections';
  settingsSectionNav.setAttribute('aria-label', 'Settings sections');

  const layoutPanelButton = createSettingsPanelButton('Layout', 'layout');
  const viewPanelButton = createSettingsPanelButton('View', 'view');
  const motionPanelButton = createSettingsPanelButton('Motion', 'motion');
  const installPanelButton = createSettingsPanelButton('Install', 'install');
  settingsSectionNav.append(
    layoutPanelButton,
    viewPanelButton,
    motionPanelButton,
    installPanelButton,
  );

  const settingsPanels = document.createElement('section');
  settingsPanels.className = 'site-menu-settings-panels';

  const layoutPanel = createSettingsPanel('layout');
  const viewPanel = createSettingsPanel('view');
  const motionPanel = createSettingsPanel('motion');
  const installPanel = createSettingsPanel('install');

  const uiLayoutGroup = createSettingGroup<AppUiLayout>({
    choices: APP_UI_LAYOUT_OPTIONS.map((option) => ({
      label: option.label,
      value: option.mode,
    })),
    currentValue: () => currentSettings.uiLayout,
    description: 'Choose how roomy the top status panel and bottom control dock should feel.',
    groupId: 'ui-layout',
    label: 'UI Layout',
    onSelect: (value) => {
      currentSettings = writeStoredAppSettings({uiLayout: value});
      options.onSettingsChange?.(currentSettings);
      syncSettingsButtons();
    },
  });

  const stageModeGroup = createSettingGroup<StageMode>({
    choices: APP_STAGE_MODE_OPTIONS.map((option) => ({
      label: option.label,
      value: option.mode,
    })),
    currentValue: () => currentSettings.preferredStageMode,
    description: 'Pick whether the app should return to the 3D DAG or the 2D plane view after onboarding.',
    groupId: 'stage-mode',
    label: 'App View',
    onSelect: (value) => {
      currentSettings = writeStoredAppSettings({preferredStageMode: value});
      options.onSettingsChange?.(currentSettings);
      syncSettingsButtons();
    },
  });

  const textStrategyGroup = createSettingGroup<TextStrategy>({
    choices: TEXT_STRATEGY_OPTIONS.map((option) => ({
      label: option.label,
      value: option.mode,
    })),
    currentValue: () => currentSettings.textStrategy,
    description: 'Set the default title and label rendering style for the app route.',
    groupId: 'text-strategy',
    label: 'Text Style',
    onSelect: (value) => {
      currentSettings = writeStoredAppSettings({textStrategy: value});
      options.onSettingsChange?.(currentSettings);
      syncSettingsButtons();
    },
  });

  const lineStrategyGroup = createSettingGroup<LineStrategy>({
    choices: LINE_STRATEGY_OPTIONS.map((option) => ({
      label: option.label,
      value: option.mode,
    })),
    currentValue: () => currentSettings.lineStrategy,
    description: 'Choose the default line language for DAG links and local plane links.',
    groupId: 'line-strategy',
    label: 'Link Style',
    onSelect: (value) => {
      currentSettings = writeStoredAppSettings({lineStrategy: value});
      options.onSettingsChange?.(currentSettings);
      syncSettingsButtons();
    },
  });

  const motionGroup = createSettingGroup<AppMotionPreference>({
    choices: APP_MOTION_PREFERENCE_OPTIONS.map((option) => ({
      label: option.label,
      value: option.mode,
    })),
    currentValue: () => currentSettings.motionPreference,
    description: 'Keep transitions cinematic or reduce motion to make the shell feel snappier.',
    groupId: 'motion-preference',
    label: 'Motion',
    onSelect: (value) => {
      currentSettings = writeStoredAppSettings({motionPreference: value});
      options.onSettingsChange?.(currentSettings);
      syncSettingsButtons();
    },
  });

  const onboardingGroup = createSettingGroup<AppOnboardingPreference>({
    choices: APP_ONBOARDING_PREFERENCE_OPTIONS.map((option) => ({
      label: option.label,
      value: option.mode,
    })),
    currentValue: () => currentSettings.onboardingPreference,
    description: 'Decide whether first-launch visitors should see the guided walkthrough automatically.',
    groupId: 'onboarding-preference',
    label: 'Onboarding',
    onSelect: (value) => {
      currentSettings = writeStoredAppSettings({onboardingPreference: value});
      options.onSettingsChange?.(currentSettings);
      syncSettingsButtons();
    },
  });

  const installCard = createInstallCard();

  layoutPanel.append(uiLayoutGroup.element, stageModeGroup.element);
  viewPanel.append(textStrategyGroup.element, lineStrategyGroup.element);
  motionPanel.append(motionGroup.element, onboardingGroup.element);
  installPanel.append(installCard.element);
  settingsPanels.append(layoutPanel, viewPanel, motionPanel, installPanel);
  settingsPage.append(settingsIntro, settingsSectionNav, settingsPanels);

  shell.append(shellHeader, navPage, settingsPage);
  overlay.append(shell);
  root.append(bar, overlay);

  let isOpen = false;

  const syncHeaderCopy = (): void => {
    if (activePage === 'nav') {
      breadcrumb.textContent = 'Menu / Navigation';
      title.textContent = 'Navigation';
      copy.textContent =
        'Jump between the app, docs, and tools from one shared route menu.';
      return;
    }

    const settingsTitles: Record<SiteMenuSettingsPanel, string> = {
      install: 'Install',
      layout: 'Layout',
      motion: 'Motion',
      view: 'View',
    };
    const settingsCopy: Record<SiteMenuSettingsPanel, string> = {
      install:
        'Check install status, then open the standalone app when the browser offers it.',
      layout:
        'Tune the panel density, default app view, and mobile-ready shell proportions.',
      motion:
        'Control how much motion and onboarding guidance the app should use by default.',
      view:
        'Pick the default text and line styles the app should use when it boots.',
    };

    breadcrumb.textContent = `Menu / Settings / ${settingsTitles[activeSettingsPanel]}`;
    title.textContent = `Settings / ${settingsTitles[activeSettingsPanel]}`;
    copy.textContent = settingsCopy[activeSettingsPanel];
  };

  const focusActiveMenuTarget = (): void => {
    if (activePage === 'settings') {
      const activeSettingButton =
        settingsPage.querySelector<HTMLButtonElement>(
          `[data-site-menu-settings-panel="${activeSettingsPanel}"] [data-site-menu-setting-button][data-active="true"]`,
        ) ??
        settingsPage.querySelector<HTMLButtonElement>(
          `[data-site-menu-settings-panel="${activeSettingsPanel}"] button`,
        );
      activeSettingButton?.focus();
      return;
    }

    const activeLink =
      navPage.querySelector<HTMLAnchorElement>('[aria-current="page"]') ??
      navPage.querySelector<HTMLAnchorElement>('a');
    activeLink?.focus();
  };

  const syncSettingsButtons = (): void => {
    currentSettings = readStoredAppSettings();
    uiLayoutGroup.sync();
    stageModeGroup.sync();
    textStrategyGroup.sync();
    lineStrategyGroup.sync();
    motionGroup.sync();
    onboardingGroup.sync();
    if (repoMenuLink) {
      repoMenuLink.href = resolveCurrentRepoUrl();
    }
  };

  const syncSettingsPanels = (): void => {
    for (const panel of settingsPanels.querySelectorAll<HTMLElement>('[data-site-menu-settings-panel]')) {
      panel.hidden = panel.dataset.siteMenuSettingsPanel !== activeSettingsPanel;
    }

    for (const button of settingsSectionNav.querySelectorAll<HTMLButtonElement>('[data-site-menu-settings-panel-target]')) {
      const isActive = button.dataset.siteMenuSettingsPanelTarget === activeSettingsPanel;
      button.classList.toggle('site-menu-page-button--active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
  };

  const syncPageVisibility = (): void => {
    navPage.hidden = activePage !== 'nav';
    settingsPage.hidden = activePage !== 'settings';
    navPageButton.classList.toggle('site-menu-page-button--active', activePage === 'nav');
    settingsPageButton.classList.toggle('site-menu-page-button--active', activePage === 'settings');
    navPageButton.setAttribute('aria-pressed', String(activePage === 'nav'));
    settingsPageButton.setAttribute('aria-pressed', String(activePage === 'settings'));
    syncSettingsPanels();
    syncHeaderCopy();

    if (isOpen) {
      focusActiveMenuTarget();
    }
  };

  const setOpen = (nextOpen: boolean): void => {
    isOpen = nextOpen;
    overlay.hidden = !nextOpen;
    root.classList.toggle('site-menu-root--open', nextOpen);
    toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    toggle.textContent = nextOpen ? 'Close' : 'Menu';
    document.body.classList.toggle('site-menu-open', nextOpen);

    if (nextOpen) {
      focusActiveMenuTarget();
      return;
    }

    toggle.focus();
  };

  const setActivePage = (nextPage: SiteMenuPage): void => {
    activePage = nextPage;
    syncPageVisibility();
  };

  const setActiveSettingsPanel = (nextPanel: SiteMenuSettingsPanel): void => {
    activeSettingsPanel = nextPanel;
    syncPageVisibility();
  };

  const handleToggleClick = (): void => {
    setOpen(!isOpen);
  };

  const handleOverlayClick = (event: Event): void => {
    if (event.target === overlay) {
      setOpen(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const handleLinkClick = (): void => {
    if (!isOpen) {
      return;
    }

    window.setTimeout(() => {
      setOpen(false);
    }, 0);
  };

  const handlePageButtonClick = (event: Event): void => {
    const target = event.currentTarget as HTMLButtonElement | null;
    const nextPage = target?.dataset.siteMenuPageTarget;

    if (nextPage === 'nav' || nextPage === 'settings') {
      setActivePage(nextPage);
    }
  };

  const handleSettingsPanelClick = (event: Event): void => {
    const target = event.currentTarget as HTMLButtonElement | null;
    const nextPanel = target?.dataset.siteMenuSettingsPanelTarget;

    if (
      nextPanel === 'layout' ||
      nextPanel === 'view' ||
      nextPanel === 'motion' ||
      nextPanel === 'install'
    ) {
      setActiveSettingsPanel(nextPanel);
    }
  };

  const unsubscribeSettings = subscribeStoredAppSettings((settings) => {
    currentSettings = settings;
    syncSettingsButtons();
  });
  const unsubscribeInstallState = subscribePwaInstallState((pwaState) => {
    installCard.sync(pwaState);
  });

  toggle.addEventListener('click', handleToggleClick);
  overlay.addEventListener('click', handleOverlayClick);
  window.addEventListener('keydown', handleKeyDown);
  navPageButton.addEventListener('click', handlePageButtonClick);
  settingsPageButton.addEventListener('click', handlePageButtonClick);

  for (const button of settingsSectionNav.querySelectorAll<HTMLButtonElement>('[data-site-menu-settings-panel-target]')) {
    button.addEventListener('click', handleSettingsPanelClick);
  }

  const links = Array.from(navPage.querySelectorAll<HTMLAnchorElement>('a'));
  for (const link of links) {
    link.addEventListener('click', handleLinkClick);
  }

  syncSettingsButtons();
  installCard.sync(getPwaInstallState());
  syncPageVisibility();

  return {
    close: () => {
      if (isOpen) {
        setOpen(false);
      }
    },
    destroy: () => {
      unsubscribeInstallState();
      unsubscribeSettings();
      toggle.removeEventListener('click', handleToggleClick);
      overlay.removeEventListener('click', handleOverlayClick);
      window.removeEventListener('keydown', handleKeyDown);
      navPageButton.removeEventListener('click', handlePageButtonClick);
      settingsPageButton.removeEventListener('click', handlePageButtonClick);

      for (const button of settingsSectionNav.querySelectorAll<HTMLButtonElement>('[data-site-menu-settings-panel-target]')) {
        button.removeEventListener('click', handleSettingsPanelClick);
      }

      for (const link of links) {
        link.removeEventListener('click', handleLinkClick);
      }

      installCard.destroy();
      document.body.classList.remove('site-menu-open');
      root.remove();
    },
    element: root,
    open: () => {
      if (!isOpen) {
        setOpen(true);
      }
    },
  };
}

export function resolveSiteHref(relativePath: string): string {
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(relativePath, baseUrl).toString();
}

export function resolveRepoMarkdownUrl(relativePath: string): string {
  const normalized = relativePath.replace(/^\.?\//u, '');
  return `${readConfiguredRepoUrl(import.meta.env.VITE_LINKER_REPO_URL as string | undefined)}/blob/main/${normalized}`;
}

function buildSiteMenuEntries(repoUrl = readConfiguredRepoUrl(import.meta.env.VITE_LINKER_REPO_URL as string | undefined)) {
  return [
    {href: './', label: 'App', route: 'app' as const},
    {href: 'new-user/', label: 'New User', route: 'new-user' as const},
    {href: 'auth/', label: 'Auth', route: 'auth' as const},
    {href: 'codex/', label: 'Codex', route: 'codex' as const},
    {href: 'logs/', label: 'Logs', route: 'logs' as const},
    {href: 'tasks/', label: 'Tasks', route: 'tasks' as const},
    {href: 'readme/', label: 'README', route: 'readme' as const},
    {href: repoUrl, label: 'GitHub', route: null},
  ] as const;
}

function createSiteMenuPageButton(
  label: string,
  page: SiteMenuPage,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'site-menu-page-button';
  button.dataset.siteMenuPageTarget = page;
  button.textContent = label;
  return button;
}

function createSettingsPanelButton(
  label: string,
  panel: SiteMenuSettingsPanel,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'site-menu-page-button site-menu-page-button--sub';
  button.dataset.siteMenuSettingsPanelTarget = panel;
  button.textContent = label;
  return button;
}

function createSettingsPanel(panel: SiteMenuSettingsPanel): HTMLElement {
  const section = document.createElement('section');
  section.className = 'site-menu-settings-panel';
  section.dataset.siteMenuSettingsPanel = panel;
  return section;
}

function createSettingGroup<T extends string>(input: {
  choices: Array<SettingChoice<T>>;
  currentValue: () => T;
  description: string;
  groupId: string;
  label: string;
  onSelect: (value: T) => void;
}): SettingGroupHandle {
  const group = document.createElement('section');
  group.className = 'site-menu-setting-group';
  group.dataset.siteMenuSettingGroup = input.groupId;

  const title = document.createElement('p');
  title.className = 'site-menu-setting-title';
  title.textContent = input.label;

  const description = document.createElement('p');
  description.className = 'site-menu-setting-description';
  description.textContent = input.description;

  const choiceNav = document.createElement('nav');
  choiceNav.className = 'site-menu-choice-grid';
  choiceNav.setAttribute('aria-label', input.label);

  const buttons: HTMLButtonElement[] = [];

  for (const choice of input.choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'site-menu-setting-button';
    button.dataset.siteMenuSettingButton = `${input.groupId}:${choice.value}`;
    button.dataset.siteMenuSettingGroup = input.groupId;
    button.dataset.siteMenuSettingValue = choice.value;
    button.textContent = choice.label;
    button.addEventListener('click', () => {
      input.onSelect(choice.value);
    });
    buttons.push(button);
    choiceNav.append(button);
  }

  const sync = (): void => {
    const currentValue = input.currentValue();

    for (const button of buttons) {
      const isActive = button.dataset.siteMenuSettingValue === currentValue;
      button.dataset.active = String(isActive);
      button.setAttribute('aria-pressed', String(isActive));
      button.classList.toggle('site-menu-setting-button--active', isActive);
    }
  };

  group.append(title, description, choiceNav);
  return {element: group, sync};
}

function createInstallCard(): {
  destroy: () => void;
  element: HTMLElement;
  sync: (state: ReturnType<typeof getPwaInstallState>) => void;
} {
  const card = document.createElement('article');
  card.className = 'site-menu-install-card';

  const title = document.createElement('p');
  title.className = 'site-menu-setting-title';
  title.textContent = 'Install App';

  const description = document.createElement('p');
  description.className = 'site-menu-setting-description';
  description.textContent =
    'Install Linker to open it in a standalone fullscreen window with the shared black-and-white shell.';

  const status = document.createElement('p');
  status.className = 'site-menu-install-status';
  status.dataset.siteMenuInstallStatus = 'true';

  const actionRow = document.createElement('nav');
  actionRow.className = 'site-menu-install-actions';
  actionRow.setAttribute('aria-label', 'Install actions');

  const installButton = document.createElement('button');
  installButton.type = 'button';
  installButton.className = 'site-menu-setting-button site-menu-install-button';
  installButton.dataset.siteMenuInstallAction = 'install';

  const openAppLink = document.createElement('a');
  openAppLink.className = 'site-menu-link site-menu-link--action';
  openAppLink.href = resolveSiteHref('./');
  openAppLink.dataset.siteMenuInstallAction = 'open-app';

  const openAppLabel = document.createElement('span');
  openAppLabel.className = 'site-menu-link-label';
  openAppLabel.textContent = 'Open App';

  const openAppMeta = document.createElement('span');
  openAppMeta.className = 'site-menu-link-meta';
  openAppMeta.textContent = 'Route';

  openAppLink.append(openAppLabel, openAppMeta);
  actionRow.append(installButton, openAppLink);
  card.append(title, description, status, actionRow);

  const handleInstallClick = (): void => {
    void promptForPwaInstall();
  };

  installButton.addEventListener('click', handleInstallClick);

  return {
    destroy: () => {
      installButton.removeEventListener('click', handleInstallClick);
    },
    element: card,
    sync: (pwaState) => {
      status.textContent = `${pwaState.statusLabel} Display mode: ${pwaState.displayMode}.`;
      installButton.textContent =
        pwaState.installability === 'installed'
          ? 'Installed'
          : pwaState.canInstall
          ? 'Install'
          : 'Unavailable';
      installButton.disabled = !pwaState.canInstall;
      installButton.dataset.active = pwaState.installability === 'installed' ? 'true' : 'false';
      installButton.classList.toggle(
        'site-menu-setting-button--active',
        pwaState.installability === 'installed',
      );
      installButton.setAttribute(
        'aria-pressed',
        pwaState.installability === 'installed' ? 'true' : 'false',
      );
    },
  };
}
