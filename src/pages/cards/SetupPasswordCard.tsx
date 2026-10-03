import {createSignal, onCleanup, onMount} from 'solid-js';
import Button from '@components/buttonTsx';
import PasswordInputField from '@components/passwordInputField';
import InputField from '@components/inputField';
import MediaHeader from '@components/mediaHeader';
import focusWhenConnected from '@helpers/dom/focusWhenConnected';
import AuthCard from '@/pages/AuthCard';
import {useAuthFlow} from '@/pages/authFlow';
import styles from '@/pages/authFlow.module.scss';

export default function SetupPasswordCard() {
  const {managers, toIm} = useAuthFlow();
  const password = new PasswordInputField({label: 'PleaseEnterFirstPassword', name: 'new-password'});
  const confirm = new PasswordInputField({label: 'PleaseReEnterPassword', name: 'confirm-password'});
  const hint = new InputField({label: 'TwoStepAuth.SetupHintPlaceholder', maxLength: 128});
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  for(const field of [password, confirm, hint]) {
    field.input.addEventListener('input', () => {
      field.input.classList.remove('error');
      setError('');
    });
  }
  async function submit() {
    if(busy()) return;
    if(!password.value || password.value !== confirm.value) {
      confirm.setError();
      setError('请输入密码，并确认两次输入一致');
      return;
    }
    if(hint.value && hint.value === password.value) {
      hint.setError();
      setError('密码提示不能与密码相同');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await managers.passwordManager.updateSettings({newPassword: password.value, hint: hint.value, email: ''});
      password.value = confirm.value = '';
      await toIm();
    } catch(err) {
      setError((err as ApiError).type || '密码设置失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  let cancelFocus: () => void;
  onMount(() => { cancelFocus = focusWhenConnected(password.input); });
  onCleanup(() => cancelFocus?.());
  return <AuthCard class={styles.pagePassword} header={<MediaHeader>
    <MediaHeader.Sticker name="TwoFactorSetupMonkeyIdle" size={120}/>
    <MediaHeader.Title>设置登录密码</MediaHeader.Title>
  </MediaHeader>}>
    {password.container}
    {confirm.container}
    {hint.container}
    <div class={styles.errorLabel} role="alert">{error()}</div>
    <Button class="btn-primary btn-color-primary" disabled={busy()} onClick={submit}>
      {busy() ? '请稍候' : '完成'}
    </Button>
    <Button class="btn-primary btn-secondary btn-primary-transparent primary" disabled={busy()}
      onClick={() => managers.apiManager.logOut()}>退出账号</Button>
  </AuthCard>;
}
