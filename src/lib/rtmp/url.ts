import {buildPublicLink, getPublicLinkPrefix} from '@helpers/publicLink';
import {IS_SAFARI} from '@environment/userAgent';
import {InputGroupCall} from '@layer';
import apiManagerProxy from '@lib/apiManagerProxy';

export function getRtmpStreamUrl(call: InputGroupCall): string {
  const base = `/rtmp/${encodeURIComponent(JSON.stringify(call))}`;

  if(IS_SAFARI) return `${base}?hls=playlist&t=${Date.now()}`;
  return `${base}?t=${Date.now()}`;
}

export async function getRtmpShareUrl(peerId: PeerId) {
  const chat = apiManagerProxy.getChat(peerId);
  if(chat._ !== 'channel') throw new Error('Not a channel');

  if(chat.username || chat.usernames?.length) {
    const username = chat.username || chat.usernames[0];
    return buildPublicLink(`${username}?livestream`, await getPublicLinkPrefix());
  }

  return buildPublicLink(`c/${chat.id}?livestream`, await getPublicLinkPrefix());
}
