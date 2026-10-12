import {serverSelectionError} from '@config/safelinkServer';

// Keep account storage, auth and all worker constructors behind validated server selection.
if(serverSelectionError) {
  import('@components/safelinkServerRecovery').then(({default: showRecovery}) => showRecovery(serverSelectionError));
} else {
  import('@/index');
}
