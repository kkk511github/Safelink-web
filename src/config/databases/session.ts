import {Database} from '.';
import {SAFELINK_STORAGE_PREFIX} from '@config/safelink';

const DATABASE_SESSION: Database<'session'> = {
  name: SAFELINK_STORAGE_PREFIX + 'telegram',
  version: 1,
  stores: [{
    name: 'session'
  }]
};

export default DATABASE_SESSION;
