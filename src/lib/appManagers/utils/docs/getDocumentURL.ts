import {FileURLType, getFileURL} from '@helpers/fileName';
import {Document, PhotoSize} from '@layer';

import getDocumentDownloadOptions from '@appManagers/utils/docs/getDocumentDownloadOptions';
import {CAN_USE_PRIMARY_SERVICE_WORKER} from '@config/safelinkServer';

type GetDocumentURLOptions = {
  download?: boolean;
  thumb?: PhotoSize.photoSize;
  supportsHlsStreaming?: boolean;
};

export default function getDocumentURL(
  doc: Document.document,
  {
    download = false,
    thumb,
    supportsHlsStreaming
  }: GetDocumentURLOptions = {}
) {
  let type: FileURLType;
  if(download && CAN_USE_PRIMARY_SERVICE_WORKER) {
    type = 'download';
  } else if(thumb) {
    type = 'thumb';
  } else if(supportsHlsStreaming && CAN_USE_PRIMARY_SERVICE_WORKER) {
    type = 'hls';
  } else if(doc.supportsStreaming && CAN_USE_PRIMARY_SERVICE_WORKER) {
    type = 'stream';
  } else {
    type = 'document';
  }

  return getFileURL(
    type,
    getDocumentDownloadOptions(doc, {
      thumb
    })
  );
}
