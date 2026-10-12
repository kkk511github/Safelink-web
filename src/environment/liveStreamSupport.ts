import Modes from '@config/modes';
import {CAN_USE_PRIMARY_SERVICE_WORKER} from '@config/safelinkServer';

const IS_LIVE_STREAM_SUPPORTED = CAN_USE_PRIMARY_SERVICE_WORKER && 'serviceWorker' in navigator && !Modes.noServiceWorker;

export default IS_LIVE_STREAM_SUPPORTED;
