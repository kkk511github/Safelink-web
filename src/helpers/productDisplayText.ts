import {DEFAULT_APP_NAME} from '@helpers/safelinkAppName';

const productNames = /safelink|telegram|telesrv|tidings?|телеграм[\p{L}]*|تيليجرام|تلگرام|텔레그램|טלגרם/giu;
const destinations = /(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)[^\s<>"']+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+|@[\p{L}\p{N}_]+|(?:[a-z]:[\\/]|\\\\|\.{1,2}\/|\/)[^\s<>"']+|(?:[\p{L}\p{N}_-]+\.)+[\p{L}]{2,}(?:[/?#][^\s<>"']*)?/giu;
const legalEntities = /[\p{L}\p{N}_-]+(?:[ \t]+[\p{L}\p{N}_-]+){0,3}[ \t]+(?:FZ-LLC|LLC|LLP|Inc\.?|Ltd\.?|Limited|GmbH|Corp\.?)(?:\b|$)/giu;

function outside(value: string, protectedText: RegExp, rewrite: (text: string) => string) {
  let result = '', offset = 0;
  for(const match of value.matchAll(protectedText)) {
    result += rewrite(value.slice(offset, match.index)) + match[0];
    offset = match.index + match[0].length;
  }
  return result + rewrite(value.slice(offset));
}

function identifierBefore(value: string, index: number) {
  if(value.slice(index - 2, index) === '__' && (index === 2 || !/[a-z0-9_]/i.test(value[index - 3]))) return false;
  return index > 0 && /[a-z0-9_]/i.test(value[index - 1]);
}

function identifierAfter(value: string, index: number) {
  if(value.slice(index, index + 2) === '__' && (index + 2 === value.length || !/[a-z0-9_]/i.test(value[index + 2]))) return false;
  return index < value.length && /[a-z0-9_]/i.test(value[index]);
}

// Only language templates pass here, before formatter arguments are inserted.
// User messages, destinations and third-party legal attribution are preserved.
export default function productDisplayText(value: string, appName = DEFAULT_APP_NAME, replacement = appName) {
  const replaceAliases = (part: string) => part.replace(productNames, (name, index: number) =>
      identifierBefore(part, index) || identifierAfter(part, index + name.length) ? name : replacement
  );
  return outside(value, destinations, (copy) => outside(copy, legalEntities, (copy) => {
    let result = '', offset = 0, index = 0;
    while(appName && (index = copy.indexOf(appName, index)) !== -1) {
      const end = index + appName.length;
      if(!identifierBefore(copy, index) && !identifierAfter(copy, end)) {
        result += replaceAliases(copy.slice(offset, index)) + replacement;
        offset = end;
      }
      index = end;
    }
    return result + replaceAliases(copy.slice(offset));
  }));
}
