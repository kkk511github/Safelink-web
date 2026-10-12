import {createSignal, For, onCleanup, onMount, Show} from 'solid-js';
import PopupElement, {createPopup} from '@components/popups/indexTsx';
import Button from '@components/buttonTsx';
import Row from '@components/rowTsx';
import {AvatarNewTsx} from '@components/avatarNew';
import {InputFieldTsx} from '@components/inputFieldTsx';
import {IconTsx} from '@components/iconTsx';
import {i18n, LangPackKey} from '@lib/langPack';
import {currentServerId, normalizeServerAddress, PRIMARY_SERVER_ID, readServerProfiles, SafeLinkServer} from '@config/safelinkServer';
import {ACCOUNT_NUMBERS, canRemoveServer, createServerProfile, getPrimaryServer, getStoredServerAccountState, groupServerAccounts, readCachedServerUser, removeServerProfile, saveServerProfile, ServerAccount} from '@lib/accounts/serverProfiles';
import {addServerAccount, switchServerAccount} from '@lib/accounts/serverNavigation';
import AccountController from '@lib/accounts/accountController';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import {createProxiedManagersForAccount} from '@lib/getProxiedManagers';
import {discoverServerIdentity} from '@lib/mtproto/safelinkServerDiscovery';
import {ConnectionStatus} from '@lib/mtproto/connectionStatus';
import rootScope from '@lib/rootScope';
import useAppName from '@stores/appName';
import {User} from '@layer';
import styles from '@components/safelinkServerSelector/style.module.scss';

type AccountRow = ServerAccount & {user?: User.user};

export default function showServerSelector() {
  let alive = true;
  let generation = 0;
  let request: AbortController;
  const invalidate = () => {generation++; request?.abort();};
  const close = () => {alive = false; invalidate();};

  createPopup(() => {
    const appName = useAppName();
    const [servers, setServers] = createSignal<SafeLinkServer[]>([]);
    const [accounts, setAccounts] = createSignal<AccountRow[]>([]);
    const [storedStates, setStoredStates] = createSignal<Record<string, Awaited<ReturnType<typeof getStoredServerAccountState>>>>({});
    const [detail, setDetail] = createSignal<SafeLinkServer>();
    const [adding, setAdding] = createSignal(false);
    const [candidate, setCandidate] = createSignal<SafeLinkServer>();
    const [address, setAddress] = createSignal('');
    const [busy, setBusy] = createSignal(false);
    const [loading, setLoading] = createSignal(true);
    const [error, setError] = createSignal('');
    const [removing, setRemoving] = createSignal(false);
    const [checks, setChecks] = createSignal<Record<string, LangPackKey>>({});
    const [connection, setConnection] = createSignal(rootScope.getConnectionStatus());

    const onConnection = () => setConnection({...rootScope.getConnectionStatus()});
    rootScope.addEventListener('connection_status_change', onConnection);
    onCleanup(() => {close(); rootScope.removeEventListener('connection_status_change', onConnection);});

    const serverName = (server: SafeLinkServer) => server.id === currentServerId ? appName() : server.name;
    const status = (server: SafeLinkServer): LangPackKey => {
      if(checks()[server.id]) return checks()[server.id];
      if(server.id !== currentServerId) return 'SafeLink.Server.Unchecked';
      const state = Object.values(connection()).find((state) => !state.isFileNetworker);
      return state?.status === ConnectionStatus.Connected ? 'SafeLink.Server.Connected' :
        state?.status === ConnectionStatus.Connecting ? 'SafeLink.Server.Connecting' : 'SafeLink.Server.Disconnected';
    };

    async function load() {
      setLoading(true);
      setError('');
      try {
        const allServers = [await getPrimaryServer(), ...readServerProfiles(localStorage)];
        const allAccounts: AccountRow[] = [];
        const states: ReturnType<typeof storedStates> = {};
        for(const server of allServers) {
          if(server.id !== currentServerId) {
            const state = states[server.id] = await getStoredServerAccountState(server);
            for(const account of state.accounts) {
              const user = await readCachedServerUser(server, account.accountNumber).catch((): User.user => undefined);
              allAccounts.push({...account, user});
            }
            continue;
          }
          for(const accountNumber of ACCOUNT_NUMBERS) {
            const data = await AccountController.get(accountNumber);
            if(!data.userId) continue;
            const user = await createProxiedManagersForAccount(accountNumber).appUsersManager.getSelf().catch((): User.user => undefined);
            allAccounts.push({serverId: server.id, accountNumber, user: user as User.user});
          }
        }
        if(!alive) return;
        setServers(allServers);
        setAccounts(allAccounts);
        setStoredStates(states);
      } catch{
        if(alive) setError('无法读取账号，请重试');
      } finally {
        if(alive) setLoading(false);
      }
    }
    onMount(load);

    async function run(action: () => Promise<unknown>) {
      if(busy() || !alive) return;
      setBusy(true);
      setError('');
      try {await action();} catch(error) {
        if(alive) setError(error instanceof Error ? error.message : '操作失败，请重试');
      } finally {if(alive) setBusy(false);}
    }

    async function check(server?: SafeLinkServer) {
      invalidate();
      const token = generation;
      const controller = request = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      setBusy(true);
      setError('');
      try {
        const endpoint = server?.endpoint || normalizeServerAddress(address().trim());
        const identity = await discoverServerIdentity(endpoint, location.origin, controller.signal);
        if(!alive || token !== generation) return;
        if(server && server.id !== PRIMARY_SERVER_ID && identity.fingerprint !== server.fingerprint) {
          setChecks((checks) => ({...checks, [server.id]: 'SafeLink.Server.PinChanged'}));
          throw new Error('服务器指纹已改变，请联系管理员核验');
        }
        if(server) {
          setChecks((checks) => ({...checks, [server.id]: 'SafeLink.Server.Checked'}));
          if(server.id === PRIMARY_SERVER_ID) {
            const updated = {...server, ...identity};
            setDetail(updated);
            setServers((servers) => servers.map((server) => server.id === PRIMARY_SERVER_ID ? updated : server));
          }
        }
        else {
          if(servers().some((server) => server.endpoint === endpoint)) throw new Error('该服务器已经添加');
          const profile = await createServerProfile(endpoint, identity);
          if(alive && token === generation) setCandidate(profile);
        }
      } catch(error) {
        if(!alive || token !== generation) return;
        if(server && checks()[server.id] !== 'SafeLink.Server.PinChanged') setChecks((checks) => ({...checks, [server.id]: 'SafeLink.Server.CheckFailed'}));
        setError(error instanceof Error && error.message.includes('指纹') ? error.message : '无法核验服务器身份，请检查 HTTPS 地址后重试');
      } finally {
        clearTimeout(timeout);
        if(alive && token === generation) setBusy(false);
      }
    }

    function back() {
      invalidate();
      setBusy(false);
      setError('');
      setCandidate();
      setAdding(false);
      setDetail();
      setRemoving(false);
    }

    const name = (account: AccountRow) => account.user ?
      [account.user.first_name, account.user.last_name].filter(Boolean).join(' ') : undefined;
    const AccountRows = (props: {server: SafeLinkServer}) => <>
      <For each={accounts().filter((account) => account.serverId === props.server.id)}>{(account) => {
        const current = account.serverId === currentServerId && account.accountNumber === getCurrentAccount();
        return <Row class={styles.account} disabled={busy() || checks()[props.server.id] === 'SafeLink.Server.PinChanged'} clickable={(event: MouseEvent) => run(() => switchServerAccount(account, event.ctrlKey || event.metaKey, undefined, () => alive))}>
          <Row.Media size="small"><AvatarNewTsx size={40} peer={account.serverId === currentServerId ? account.user : undefined} peerId={account.serverId === currentServerId ? account.user?.id?.toPeerId() : undefined}
            accountNumber={account.serverId === currentServerId ? account.accountNumber : undefined}
            peerTitle={name(account) || `账号 ${account.accountNumber}`} /></Row.Media>
          <Row.Title titleRight={current && <IconTsx icon="check" />}>{name(account) || i18n('SafeLink.Account.Slot', [account.accountNumber])}</Row.Title>
          <Show when={current}><Row.Subtitle>{i18n('SafeLink.Account.Current')}</Row.Subtitle></Show>
        </Row>;
      }}</For>
      <Row class={styles.account} disabled={busy() || loading() || checks()[props.server.id] === 'SafeLink.Server.PinChanged'} clickable={(event: MouseEvent) => run(() => addServerAccount(props.server.id, event.ctrlKey || event.metaKey, () => alive))}>
        <Row.Icon icon="plus" /><Row.Title>{i18n('SafeLink.Account.Add')}</Row.Title>
      </Row>
    </>;

    return <PopupElement class={styles.popup} closable show onClose={close}>
      <PopupElement.Header>
        <Show when={adding() || detail()} fallback={<PopupElement.CloseButton />}>
          <Button.Icon icon="back" onClick={back} aria-label="返回服务器列表" />
        </Show>
        <PopupElement.Title>{i18n(adding() ? 'SafeLink.Server.Add' : detail() ? 'SafeLink.Server.Details' : 'SafeLink.Servers')}</PopupElement.Title>
      </PopupElement.Header>
      <PopupElement.Scrollable class={styles.content}>
        <Show when={error()}><p class={styles.error} role="alert">{error()}</p></Show>
        <Show when={loading()}><p class={styles.notice} role="status">{i18n('PleaseWait')}</p></Show>
        <Show when={!adding() && !detail()}>
          <For each={groupServerAccounts(servers(), accounts())}>{({server, accounts: group}) => <section class={styles.group} aria-label={serverName(server)}>
            <Row class={styles.server} clickable={() => {setDetail(server); setError('');}}>
              <Row.Media size="small"><AvatarNewTsx size={40} peerTitle={serverName(server)} /></Row.Media>
              <Row.Title titleRight={server.id === currentServerId && i18n('SafeLink.Server.Current')}>{serverName(server)}</Row.Title>
              <Row.Subtitle><span class={styles.endpoint}>{server.endpoint}</span><span>{i18n(status(server))}</span></Row.Subtitle>
            </Row>
            <Show when={storedStates()[server.id]?.locked} fallback={<Show when={!group.length && !loading()}><p class={styles.empty}>{i18n('SafeLink.Server.NoAccounts')}</p></Show>}>
              <p class={styles.empty}>{i18n('SafeLink.Server.LockedAccounts')}</p>
            </Show>
            <AccountRows server={server} />
          </section>}</For>
          <Show when={error() && !servers().length}><Button primaryTransparent text="SafeLink.Server.Retry" onClick={load} /></Show>
          <Row clickable={() => {back(); setAdding(true);}}><Row.Icon icon="plus" /><Row.Title>{i18n('SafeLink.Server.Add')}</Row.Title></Row>
        </Show>
        <Show when={detail()}>{(server) => <>
          <Row><Row.Title>{serverName(server())}</Row.Title><Row.Subtitle>{server().id === PRIMARY_SERVER_ID ? i18n('SafeLink.Server.Primary') : i18n(status(server()))}</Row.Subtitle></Row>
          <dl class={styles.details}>
            <dt>{i18n('SafeLink.Server.Address')}</dt><dd>{server().endpoint}</dd>
            <dt>DC</dt><dd>2</dd>
            <dt>{i18n('SafeLink.Server.Fingerprint')}</dt><dd class={styles.fingerprint}>{server().fingerprint}</dd>
          </dl>
          <p class={styles.notice} role="status">{i18n(busy() ? 'SafeLink.Server.Checking' : status(server()))}</p>
          <Button primaryTransparent text="SafeLink.Server.Check" disabled={busy()} onClick={() => check(server())} />
          <AccountRows server={server()} />
          <Show when={canRemoveServer(server().id, accounts()) && storedStates()[server().id]?.count === 0 && !storedStates()[server().id]?.locked} fallback={<p class={styles.notice}>{i18n('SafeLink.Server.RemoveBlocked')}</p>}>
            <Show when={removing()} fallback={<Button primaryTransparent class="danger" text="SafeLink.Server.Remove" onClick={() => setRemoving(true)} />}>
              <p class={styles.notice}>{i18n('SafeLink.Server.RemoveConfirm')}</p>
              <Button primaryTransparent text="SafeLink.Server.Cancel" onClick={() => setRemoving(false)} />
              <Button primaryTransparent class="danger" text="SafeLink.Server.Remove" onClick={() => run(async() => {await removeServerProfile(server()); back(); await load();})} />
            </Show>
          </Show>
        </>}</Show>
        <Show when={adding()}>
          <InputFieldTsx plainText label="SafeLink.Server.Address" value={address()} disabled={busy()} onRawInput={(value) => {invalidate(); setAddress(value); setCandidate(); setError('');}} />
          <Show when={candidate()}>{(server) => <>
            <dl class={styles.details}><dt>{server().name}</dt><dd>{server().endpoint}</dd><dt>{i18n('SafeLink.Server.Fingerprint')}</dt><dd class={styles.fingerprint}>{server().fingerprint}</dd></dl>
            <p class={styles.notice}>{i18n('SafeLink.Server.ConfirmFingerprint')}</p>
            <Button primaryFilled class={styles.action} text="SafeLink.Server.Confirm" onClick={() => run(async() => {saveServerProfile(server()); back(); await load();})} />
          </>}</Show>
          <Show when={!candidate()}><Button primaryFilled class={styles.action} disabled={busy() || !address().trim()} text={busy() ? 'SafeLink.Server.Checking' : 'SafeLink.Server.Check'} onClick={() => check()} /></Show>
        </Show>
      </PopupElement.Scrollable>
    </PopupElement>;
  });
}
