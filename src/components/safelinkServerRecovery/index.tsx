import {createSignal, For, Show} from 'solid-js';
import {render} from 'solid-js/web';
import {ADD_SERVER_ACCOUNT_QUERY_PARAM, PRIMARY_SERVER_ID, readServerProfiles, SafeLinkServer, SERVER_QUERY_PARAM, WORKER_SERVER_QUERY_PARAM} from '@config/safelinkServer';
import {DEFAULT_APP_NAME} from '@helpers/safelinkAppName';
import Modes from '@config/modes';
import '@/materialize.scss';
import '@/scss/style.scss';
import styles from '@components/safelinkServerRecovery/style.module.scss';

// Deliberately avoid manager-backed widgets and language/theme storage until a valid server is chosen.
export default function showServerRecovery(error: Error) {
  let servers: SafeLinkServer[] = [];
  try {servers = readServerProfiles(localStorage);} catch{}
  const host = document.createElement('div');
  host.id = 'safelink-server-recovery';
  document.body.append(host);
  document.body.classList.add('safelink-selection-error');
  document.documentElement.lang = 'zh-CN';
  if(Modes.a11y) document.documentElement.classList.add('a11y');

  const select = (serverId: string) => {
    const url = new URL(location.href);
    const previousAccount = url.searchParams.get('returnServer') === serverId ? Number(url.searchParams.get('returnAccount')) : 1;
    for(const name of [SERVER_QUERY_PARAM, WORKER_SERVER_QUERY_PARAM, ADD_SERVER_ACCOUNT_QUERY_PARAM, 'account', 'returnServer', 'returnAccount']) url.searchParams.delete(name);
    if(serverId !== PRIMARY_SERVER_ID) url.searchParams.set(SERVER_QUERY_PARAM, serverId);
    if([2, 3, 4].includes(previousAccount)) url.searchParams.set('account', '' + previousAccount);
    location.assign(url.href);
  };

  render(() => {
    const [picker, setPicker] = createSignal(false);
    return <main class={styles.wrap}>
      <img class={styles.logo} src="assets/img/vochat.png" alt="" />
      <h1>{DEFAULT_APP_NAME}</h1>
      <h2>无法选择服务器</h2>
      <p role="alert">{error.message}</p>
      <p>尚未连接任何服务器，账号数据未更改。</p>
      <button class="btn-primary btn-color-primary" onClick={() => select(PRIMARY_SERVER_ID)}>返回主服务器</button>
      <button class="btn-primary primary btn-transparent" aria-expanded={picker()} onClick={() => setPicker(!picker())}>服务器与账号</button>
      <Show when={picker()}>
        <nav aria-label="服务器列表">
          <For each={servers}>{(server) => <button class={styles.server} onClick={() => select(server.id)}>
            <span class={styles.avatar} aria-hidden="true">{Array.from(server.name).slice(0, 2).join('')}</span>
            <span><strong>{server.name}</strong><span class={styles.endpoint}>{server.endpoint}</span></span>
          </button>}</For>
          <Show when={!servers.length}><p>暂无有效服务器记录。原始记录和账号数据均已保留。</p></Show>
        </nav>
      </Show>
      <button class="btn-primary primary btn-transparent" onClick={() => location.reload()}>重试</button>
    </main>;
  }, host);
}
