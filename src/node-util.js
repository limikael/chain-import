import {fileURLToPath} from 'url';

export function dirnameFromImportMeta(meta) {
    return fileURLToPath(new URL('.', meta.url));
}
