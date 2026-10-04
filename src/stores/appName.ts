import {createRoot, createSignal} from 'solid-js';
import {DEFAULT_APP_NAME, normalizeAppName} from '@helpers/safelinkAppName';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import {discoverServer, getServerDiscoveryUrl} from '@lib/mtproto/safelinkServerDiscovery';
import type {AppManagers} from '@lib/managers';
import rootScope from '@lib/rootScope';

const [appName, setAppName] = createRoot(() => createSignal(DEFAULT_APP_NAME));
let generation = 0;
let applyConfig: (config: MTAppConfig) => void;

rootScope.addEventListener('app_config', (config) => applyConfig?.(config));

export function initializeAppName(cachedConfig: MTAppConfig, managers: AppManagers) {
  const currentGeneration = ++generation;
  const account = getCurrentAccount();
  const wsUrl = import.meta.env.VITE_MTPROTO_WS_URL;
  const origin = location.origin;
  const server = wsUrl ? getServerDiscoveryUrl(wsUrl, origin) : undefined;
  let hasConfig = false;
  const isCurrent = () => currentGeneration === generation && account === getCurrentAccount();

  setAppName(DEFAULT_APP_NAME);
  applyConfig = (config) => {
    if(!isCurrent() || !config || config.safelink_server_origin !== server) return;
    hasConfig = true;
    setAppName(normalizeAppName(config.safelink_app_name));
  };
  applyConfig(cachedConfig);

  if(wsUrl) {
    discoverServer(wsUrl, origin).then((descriptor) => {
      if(isCurrent() && !hasConfig && descriptor) setAppName(descriptor.name);
    });
  }

  // The worker's app_config event is already filtered to this tab's account.
  managers.apiManager.getAppConfig(true).then((config) => {
    if(isCurrent()) applyConfig(config);
  }).catch(() => {});
}

export default function useAppName() {
  return appName;
}
