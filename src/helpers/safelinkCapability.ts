import type {MTAppConfig} from '@/appConfig';
import {loginRequestWithDeadline} from '@helpers/safelinkLogin';

type SafeLinkCapability = 'safelink_web_auth_tokens_enabled' | 'safelink_top_peers_enabled';

export default async function safelinkCapability(getAppConfig: () => MaybePromise<MTAppConfig>, capability: SafeLinkCapability) {
  if(!import.meta.env.VITE_MTPROTO_WS_URL) return true;
  try {
    const config = await loginRequestWithDeadline(Promise.resolve(getAppConfig()), 10000);
    return config?.[capability] === true;
  } catch{
    return false;
  }
}
