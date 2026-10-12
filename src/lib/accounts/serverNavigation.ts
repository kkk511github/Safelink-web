import {ADD_SERVER_ACCOUNT_QUERY_PARAM, currentServerId, PRIMARY_SERVER_ID, readServerProfiles, SERVER_QUERY_PARAM} from '@config/safelinkServer';
import {ActiveAccountNumber} from '@lib/accounts/types';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import {createAppURLForAccount} from '@lib/accounts/createAppURLForAccount';
import AccountController from '@lib/accounts/accountController';
import {ACCOUNT_NUMBERS, getAvailableAccountSlot, getStoredServerAccountState, getPrimaryServer, isReadableAccountRecord} from '@lib/accounts/serverProfiles';
import {MAX_ACCOUNTS, MAX_ACCOUNTS_FREE} from '@lib/accounts/constants';
import apiManagerProxy from '@lib/apiManagerProxy';
import appNavigationController from '@components/appNavigationController';
import {saveEncryptionKeyForHandoff} from '@lib/passcode/keyHandoff';
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode';
import sessionStorage from '@lib/sessionStorage';

export type ServerAccountTarget = {serverId: string, accountNumber: ActiveAccountNumber};

export function getLoginReturnTarget(url = location.href): ServerAccountTarget | undefined {
  const params = new URL(url).searchParams;
  const serverId = params.get('returnServer');
  const account = Number(params.get('returnAccount'));
  if(!serverId || !ACCOUNT_NUMBERS.includes(account as ActiveAccountNumber)) return;
  if(serverId !== PRIMARY_SERVER_ID) {
    try {if(!readServerProfiles(localStorage).some((server) => server.id === serverId)) return;}
    catch{return;}
  }
  return {serverId, accountNumber: account as ActiveAccountNumber};
}

export function serverAccountURL(target: ServerAccountTarget, returnTarget?: ServerAccountTarget) {
  const url = createAppURLForAccount(target.accountNumber);
  if(target.serverId === PRIMARY_SERVER_ID) url.searchParams.delete(SERVER_QUERY_PARAM);
  else url.searchParams.set(SERVER_QUERY_PARAM, target.serverId);
  url.searchParams.delete('returnServer');
  url.searchParams.delete('returnAccount');
  url.searchParams.delete(ADD_SERVER_ACCOUNT_QUERY_PARAM);
  if(returnTarget) {
    url.searchParams.set('returnServer', returnTarget.serverId);
    url.searchParams.set('returnAccount', returnTarget.accountNumber + '');
  }
  return url;
}

export async function switchServerAccount(target: ServerAccountTarget, newTab = false, returnTarget?: ServerAccountTarget, isCurrent = () => true, deferAllocation = false) {
  const accounts = await readUnlockedAccounts();
  if(!isCurrent()) return;
  // Existing non-sensitive metadata: a cancelled empty login must remain provably empty on return.
  await sessionStorage.set({number_of_accounts: accounts.filter(({data}) => data.userId).length});
  if(!newTab && await DeferredIsUsingPasscode.isUsingPasscode()) await saveEncryptionKeyForHandoff();
  if(!isCurrent()) return;
  const url = serverAccountURL(target, returnTarget);
  if(deferAllocation) url.searchParams.set(ADD_SERVER_ACCOUNT_QUERY_PARAM, '1');
  if(newTab) window.open(url, '_blank');
  else appNavigationController.reload(url);
}

async function readUnlockedAccounts() {
  const currentAccounts = await Promise.all(ACCOUNT_NUMBERS.map(async(accountNumber) => ({accountNumber, data: await AccountController.get(accountNumber)})));
  if(currentAccounts.some(({data}) => !isReadableAccountRecord(data))) {
    throw new Error('无法确认已解锁账号状态，未分配新的账号位置');
  }
  return currentAccounts;
}

export async function addServerAccount(serverId: string, newTab = false, isCurrent = () => true) {
  const currentAccounts = await readUnlockedAccounts();
  const servers = [await getPrimaryServer(), ...readServerProfiles(localStorage)];
  const server = servers.find((server) => server.id === serverId);
  if(!server) throw new Error('服务器不存在');
  const existingReturn = getLoginReturnTarget();
  const active = currentAccounts.find((account) => account.accountNumber === getCurrentAccount() && account.data.userId);
  const fallback = currentAccounts.find((account) => account.data.userId);
  const returnTarget = existingReturn || (active || fallback ? {serverId: currentServerId, accountNumber: (active || fallback).accountNumber} : undefined);
  // Another namespace may be passcode-encrypted and its count does not reveal the occupied slots.
  // Allocate only after entering that server and unlocking its own AccountController.
  if(serverId !== currentServerId) {
    await switchServerAccount({serverId, accountNumber: 1}, newTab, returnTarget, isCurrent, true);
    return;
  }
  let total = currentAccounts.filter((account) => account.data.userId).length;
  for(const server of servers) {
    if(server.id === currentServerId) continue;
    const {count} = await getStoredServerAccountState(server);
    if(count === undefined) throw new Error('无法确认其他服务器的账号数量，请先打开并解锁该服务器');
    total += count;
  }
  if(total >= MAX_ACCOUNTS || (total >= MAX_ACCOUNTS_FREE && !await apiManagerProxy.hasSomeonePremium())) {
    throw new Error('已达到现有账号上限');
  }
  const slot = getAvailableAccountSlot(currentAccounts.filter((account) => account.data.userId));
  if(!slot) throw new Error('没有可用的账号位置');
  await switchServerAccount({serverId, accountNumber: slot}, newTab, returnTarget, isCurrent);
}
