const chunkedFileStreamIterableFactory = (readableStream) => {
  const defaultChunkSize = 30720;
  let _chunkSize;
  // let chunk;
  return {
    get chunkByteSize() {
      return this.chunkSize * 1024;
    },

    get chunkSize() {
      return _chunkSize || defaultChunkSize;
    },

    set chunkSize(value) {
      if (value <= 0)
        throw new RangeError('chunkSize must be a whole number (Int > 0)');
      _chunkSize = value;
    },
    async *[Symbol.asyncIterator]() {
      let chunk;
      const reader = readableStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Last chunk, if any bits remain
            if (chunk) {
              const outgoingChunk = chunk;
              chunk = undefined;
              yield outgoingChunk;
            }
            break;
          }

          const normalizedBlobChunk =
            value instanceof Uint8Array
              ? new Blob([value], { type: 'application/octet-stream' })
              : value;

          chunk = chunk
            ? new Blob([chunk, normalizedBlobChunk])
            : normalizedBlobChunk;

          // NOTE: Since we don't know how big the next chunk needs to be, we should
          // just have a single blob that we "peel away bytes from" for each chunk
          // as we iterate.
          while (chunk) {
            if (chunk.size === this.chunkByteSize) {
              const outgoingChunk = chunk;
              chunk = undefined;
              yield outgoingChunk;
              break;
            } else if (chunk.size < this.chunkByteSize) {
              break;
            } else {
              const outgoingChunk = chunk.slice(0, this.chunkByteSize);
              chunk = chunk.slice(this.chunkByteSize);
              yield outgoingChunk;
            }
          }
        }
      } finally {
        // Last chunk, if any bits remain
        if (chunk) {
          const outgoingChunk = chunk;
          chunk = undefined;
          yield outgoingChunk;
        }
        reader.releaseLock();
        return;
      }
    },
  };
};

const MIN_FAKE_UPLOAD_TIME = 5000;
const MAX_FAKE_UPLOAD_TIME = 10000;
let chunks = [];
const uploadChunk = async (
  chunk,
  { retries = 4, retryDelay = 1, headers, endpoint } = {}
) => {
  const lastChunkStart = new Date();
  return new Promise((resolve, reject) => {
    const lastChunkEnd = new Date();
    const lastChunkInterval =
      (lastChunkEnd.getTime() - lastChunkStart.getTime()) / 1000;
    setTimeout(() => {
      console.log('uploaded');
      chunks.push(chunk);
      resolve(lastChunkInterval);
    }, Math.floor(Math.random() * (MAX_FAKE_UPLOAD_TIME - MIN_FAKE_UPLOAD_TIME + 1) + MIN_FAKE_UPLOAD_TIME));
  });
};

const uploaderSimpleFactory = (file) => {
  let _paused = false;
  let fileUploadDone = false;
  let uploadDoneCb = () => {};

  let chunkSize = 30720;
  let maxChunkSize = 512000; // in kB
  let minChunkSize = 256; // in kB

  const iterable = chunkedFileStreamIterableFactory(file.stream());
  iterable.chunkSize = chunkSize;
  const iterator = iterable[Symbol.asyncIterator]();

  return {
    get paused() {
      return _paused;
    },

    set paused(value) {
      _paused = value;
      if (!this.paused) {
        this.upload();
      }
    },

    async upload() {
      while (!(fileUploadDone || _paused)) {
        const { value: chunk, done } = await iterator.next();
        if (chunk) {
          let rttSecs = await uploadChunk(chunk);
          let unevenChunkSize;
          if (rttSecs < 10) {
            unevenChunkSize = Math.min(chunkSize * 2, maxChunkSize);
          } else if (lastChunkInterval > 30) {
            unevenChunkSize = Math.max(chunkSize / 2, minChunkSize);
          }
          // ensure it's a multiple of 256k
          chunkSize = Math.ceil(unevenChunkSize / 256) * 256;

          iterable.chunkSize = chunkSize;
          console.log('chunkByteSize', iterable.chunkByteSize);
        }

        fileUploadDone = done;
      }

      if (fileUploadDone && uploadDoneCb) {
        uploadDoneCb();
      }
    },

    get onUploadDone() {
      return uploadDoneCb;
    },

    set onUploadDone(cb) {
      uploadDoneCb = cb;
    },
  };
};

const picker = document.getElementById('picker');
picker.onchange = async () => {
  const endpoint = document.getElementById('location').value;
  const file = picker.files[0];
  console.log('file', file);

  const uploader = uploaderSimpleFactory(file);
  uploader.onUploadDone = () => {
    const uploadedFile = new Blob(chunks);
    const url = URL.createObjectURL(uploadedFile);
    document.getElementById('video').src = url;
  };

  document
    .getElementById('paused')
    .addEventListener('change', () => (uploader.paused = !uploader.paused));

  uploader.upload();
};
