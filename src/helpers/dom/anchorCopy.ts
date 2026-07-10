import {toastNew} from '@components/toast';
import {LangPackKey} from '@lib/langPack';
import {copyTextToClipboard} from '@helpers/clipboard';
import cancelEvent from '@helpers/dom/cancelEvent';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import {
  buildPublicLink,
  DEFAULT_PUBLIC_LINK_PREFIX,
  getPublicLinkPrefix
} from '@helpers/publicLink';

export default function anchorCopy(options: Partial<{
  // href: string,
  mePath: string,
  username: string
}> = {}) {
  const anchor = document.createElement('a');
  anchor.classList.add('anchor-copy');

  let copyWhat: string;
  const copyText: LangPackKey = options.username ? 'UsernameCopied' : 'LinkCopied';
  const path = options.mePath || options.username;
  const applyPrefix = (prefix: string) => {
    if(!path) return;

    const href = buildPublicLink(path, prefix);
    copyWhat = anchor.href = href;
    anchor.innerText = options.username ? '@' + options.username : href;
  };

  applyPrefix(DEFAULT_PUBLIC_LINK_PREFIX);
  getPublicLinkPrefix().then(applyPrefix);

  attachClickEvent(anchor, async(e) => {
    cancelEvent(e);
    if(path) copyWhat = buildPublicLink(path, await getPublicLinkPrefix());
    copyTextToClipboard(copyWhat ?? anchor.href);
    toastNew({langPackKey: copyText});
  });

  return anchor;
}
