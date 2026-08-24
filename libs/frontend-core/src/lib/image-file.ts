// Client-side file helper shared across plugins: turn a picked File into a
// base64 data URL the backend can persist through the attachment pipeline.
//
// Deliberately the only one. A companion `readAndDownscale` used to shrink
// images before upload, which meant the original was destroyed in the browser
// and the server only ever saw a reduced copy. Since #113 the backend keeps the
// original from every source and derives its own previews, so shrinking here
// would throw away detail nothing can recover — upload the file as it is.

// Read any file into a base64 data URL, unchanged.
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-failed'));
    reader.onload = () => {
      // readAsDataURL always yields a string; the guard narrows off the
      // ArrayBuffer/null arms of FileReader.result without an unchecked cast.
      const { result } = reader;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('read-failed'));
    };
    reader.readAsDataURL(file);
  });
}
