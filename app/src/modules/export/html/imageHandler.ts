import { invoke } from '@tauri-apps/api/core'

function getMimeType(path: string): string {
    if (path.endsWith('.png')) return 'image/png'
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
    if (path.endsWith('.gif')) return 'image/gif'
    if (path.endsWith('.svg')) return 'image/svg+xml'
    return 'application/octet-stream'
}

export async function convertImagesToBase64(html: string, baseDir: string): Promise<string> {
    const imgRegex = /<img[^>]+src="([^">]+)"/g;
    let resultHtml = html;

    const matches = [...html.matchAll(imgRegex)];

    for (const match of matches) {
        const src = match[1];

        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
            continue;
        }

        try {
            let imagePath = src;
            if (!src.match(/^[a-zA-Z]:/)) {
                if (src.startsWith('./')) {
                    imagePath = baseDir + '/' + src.substring(2);
                } else {
                    imagePath = baseDir + '/' + src;
                }
            }
            imagePath = imagePath.replace(/\\/g, '/');

            const result = await invoke<{ Ok?: { data: number[] } }>('read_binary_file', { path: imagePath, trace_id: null });
            if (result?.Ok?.data) {
                const buffer = new Uint8Array(result.Ok.data);
                const base64 = btoa(String.fromCharCode.apply(null, Array.from(buffer)));

                const mime = getMimeType(imagePath);
                const dataUri = `data:${mime};base64,${base64}`;

                resultHtml = resultHtml.replace(src, dataUri);
            }
        } catch (e) {
            console.warn('Failed to embed image:', src, e);
        }
    }

    return resultHtml;
}
