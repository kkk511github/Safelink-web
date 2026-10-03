import {createSignal, JSX, onMount} from 'solid-js';

import AvatarEdit, {AvatarEditPayload} from '@components/avatarEdit';
import Button from '@components/buttonTsx';
import InputField from '@components/inputField';
import MediaHeader from '@components/mediaHeader';
import blurActiveElement from '@helpers/dom/blurActiveElement';
import {LangPackKey, i18n} from '@lib/langPack';
import wrapEmojiText from '@lib/richTextProcessor/wrapEmojiText';

import AuthCard from '@/pages/AuthCard';
import {CardSpec, useAuthFlow} from '@/pages/authFlow';
import styles from '@/pages/authFlow.module.scss';

if(import.meta.hot) import.meta.hot.accept();

type Spec = Extract<CardSpec, {name: 'signUp'}>;

/**
 * Card variant of `pageSignUp`. Avatar uploader (canvas + camera-add icon)
 * and two name inputs. The card title doubles as a live preview of the
 * entered full name.
 */
export default function SignUpCard(props: {spec: Spec}) {
  const {managers, toIm} = useAuthFlow();

  /* ---------- state ---------- */

  const [submitting, setSubmitting] = createSignal(false);
  const [signUpKey, setSignUpKey] = createSignal<LangPackKey>('StartMessaging');
  const [policyLoaded, setPolicyLoaded] = createSignal(false);
  const [inviteRequired, setInviteRequired] = createSignal(false);
  const [errorText, setErrorText] = createSignal('');

  /* ---------- avatar (sticker slot) ---------- */

  let uploadAvatar: AvatarEditPayload | undefined;

  // the same picker + media editor every other avatar in the app goes through; the payload is
  // a pair of thunks, so nothing is uploaded until the account exists
  const avatarEdit = new AvatarEdit((payload) => {
    uploadAvatar = payload;
  });

  /* ---------- inputs ---------- */

  const nameInputField = new InputField({
    label: 'FirstName',
    maxLength: 70
  });

  const lastNameInputField = new InputField({
    label: 'LastName',
    maxLength: 64
  });
  const inviteInputField = new InputField({
    plainText: true,
    name: 'registration-invite',
    labelText: document.createDocumentFragment(),
    maxLength: 64,
    showLengthOn: -1,
    withBorder: true
  });
  inviteInputField.input.setAttribute('aria-label', '邀请码');
  inviteInputField.input.removeAttribute('aria-labelledby');
  const invitePlaceholder = document.createElement('span');
  invitePlaceholder.className = styles.invitePlaceholder;
  inviteInputField.container.append(invitePlaceholder);
  inviteInputField.input.addEventListener('input', () => {
    invitePlaceholder.hidden = !!inviteInputField.value;
    inviteInputField.input.classList.remove('error');
    setErrorText('');
  });

  async function loadPolicy() {
    setPolicyLoaded(false);
    try {
      const policy = await managers.apiManager.registrationPolicy();
      setInviteRequired(policy.inviteRequired);
      invitePlaceholder.textContent = policy.inviteRequired ? '邀请码（必填）' : '邀请码（选填）';
      setPolicyLoaded(true);
    } catch{
      setErrorText('无法读取注册配置，请重试');
    }
  }

  /* ---------- live full-name preview (drives MediaHeader.Title) ---------- */

  const [titleContent, setTitleContent] = createSignal<JSX.Element>(i18n('YourName'));

  function handleNameInput() {
    const name = nameInputField.value || '';
    const lastName = lastNameInputField.value || '';

    const fullName = (name || lastName) ? (name + ' ' + lastName).trim() : '';

    setTitleContent(fullName ? wrapEmojiText(fullName) : i18n('YourName'));
  }

  nameInputField.input.addEventListener('input', handleNameInput);
  lastNameInputField.input.addEventListener('input', handleNameInput);

  /* ---------- submit ---------- */

  async function sendAvatar() {
    if(!uploadAvatar) return;

    const [file, video] = await Promise.all([uploadAvatar.file(), uploadAvatar.video?.()]);
    await managers.appProfileManager.uploadProfilePhoto({
      file,
      video,
      videoStartTs: uploadAvatar.videoStartTs
    });
  }

  function onSubmit() {
    if(submitting()) return;
    if(!policyLoaded()) { loadPolicy(); return; }
    if(inviteRequired() && !inviteInputField.value.trim()) {
      inviteInputField.input.classList.add('error');
      setErrorText('请输入邀请码');
      return;
    }
    if(nameInputField.input.classList.contains('error') || lastNameInputField.input.classList.contains('error')) {
      return;
    }

    if(!nameInputField.value.length) {
      nameInputField.input.classList.add('error');
      return;
    }

    setSubmitting(true);

    const name = nameInputField.value.trim();
    const lastName = lastNameInputField.value.trim();

    const params = {
      phone_number: props.spec.payload.phone_number,
      phone_code_hash: props.spec.payload.phone_code_hash,
      first_name: name,
      last_name: lastName
    };

    setSignUpKey('PleaseWait');

    managers.apiManager.registerAccount(params, inviteInputField.value).then(async(response) => {
      switch(response._) {
        case 'auth.authorization':
          await managers.apiManager.completeAuthorization(response);
          if(response.pFlags.setup_password_required && response.otherwise_relogin_days === 0) {
            await toIm();
            return;
          }
          sendAvatar().finally(() => {
            toIm();
          });
          break;
        default:
          setSignUpKey(response._ as LangPackKey);
          setSubmitting(false);
          break;
      }
    }).catch((err) => {
      setSubmitting(false);
      setSignUpKey('StartMessaging');

      switch(err.type) {
        case 'INVITE_CODE_REQUIRED':
        case 'INVITE_CODE_INVALID':
          inviteInputField.input.classList.add('error');
          setErrorText(err.type === 'INVITE_CODE_REQUIRED' ? '请输入邀请码' : '邀请码无效、已过期或名额已用完');
          loadPolicy();
          break;
        default:
          setErrorText(err.type);
          break;
      }
    });
  }

  /* ---------- lifecycle ---------- */

  onMount(() => {
    loadPolicy();
    managers.appStateManager.pushToState('authState', {
      _: 'authStateSignUp',
      authCode: props.spec.payload
    });

    blurActiveElement();
  });

  return (
    <AuthCard
      class={styles.pageSignUp}
      header={
        <MediaHeader>
          <MediaHeader.Sticker element={avatarEdit.container} size={120}/>
          <MediaHeader.Title tag="h1">{titleContent()}</MediaHeader.Title>
          <MediaHeader.Subtitle>{i18n('Login.Register.Subtitle')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      {nameInputField.container}
      {lastNameInputField.container}
      {inviteInputField.container}
      <div role="alert" class={styles.errorLabel}>{errorText()}</div>
      <Button
        class="btn-primary btn-color-primary"
        disabled={submitting()}
        onClick={onSubmit}
      >
        {i18n(signUpKey())}
        {submitting() && (
          <svg xmlns="http://www.w3.org/2000/svg" class="preloader-circular" viewBox="25 25 50 50">
            <circle class="preloader-path" cx="50" cy="50" r="20" fill="none" stroke-miterlimit="10"/>
          </svg>
        )}
      </Button>
    </AuthCard>
  );
}
