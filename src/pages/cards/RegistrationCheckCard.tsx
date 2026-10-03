import {createSignal} from 'solid-js';
import Button from '@components/buttonTsx';
import MediaHeader from '@components/mediaHeader';
import AuthCard from '@/pages/AuthCard';
import {useAuthFlow} from '@/pages/authFlow';

export default function RegistrationCheckCard() {
  const {managers, toIm} = useAuthFlow();
  const [busy, setBusy] = createSignal(false);
  async function retry() {
    if(busy()) return;
    setBusy(true);
    try { await toIm(); } finally { setBusy(false); }
  }
  return <AuthCard header={<MediaHeader>
    <MediaHeader.Title>暂时无法连接 SafeLink</MediaHeader.Title>
  </MediaHeader>}>
    <Button class="btn-primary btn-color-primary" disabled={busy()} onClick={retry}>
      {busy() ? '请稍候' : '重试'}
    </Button>
    <Button class="btn-primary btn-secondary btn-primary-transparent primary" disabled={busy()}
      onClick={() => managers.apiManager.logOut()}>退出账号</Button>
  </AuthCard>;
}
