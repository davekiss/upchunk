const chunkedFileStreamIterableFactory = (readableStream) => {
  const defaultChunkSize = 30720;
  let _chunkSize;
  let chunk;
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
    [Symbol.asyncIterator]: async function* () {
      const reader = readableStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          console.log('next stream chunk value.length', value.length);
          if (done) {
            console.log('internal done');
            // Last chunk, if any bits remain
            if (chunk) {
              const outgoingChunk = chunk;
              chunk = undefined;
              console.log('last outgoingChunk.size', outgoingChunk.size);
              yield outgoingChunk;
              break;
            }
          }

          const normalizedBlobChunk =
            value instanceof Uint8Array
              ? new Blob([value], { type: 'application/octet-stream' })
              : value;

          console.log(
            'next normalizedBlobChunk.size',
            normalizedBlobChunk.size
          );
          chunk = chunk
            ? new Blob([chunk, normalizedBlobChunk])
            : normalizedBlobChunk;

          console.log('next local stored chunk.size', chunk.size);

          // NOTE: Since we don't know how big the next chunk needs to be, we should
          // just have a single blob that we "peel away bytes from" for each chunk
          // as we iterate.
          while (chunk) {
            // Last Chunk
            if (chunk.size === this.chunkByteSize) {
              const outgoingChunk = chunk;
              chunk = undefined;
              console.log('next outgoingChunk.size', outgoingChunk.size);
              yield outgoingChunk;
              break;
            } else if (chunk.size < this.chunkByteSize) {
              console.log(
                'too small chunk, remaining local stored chunk.size',
                chunk.size
              );
              break;
            }
            const outgoingChunk = chunk.slice(0, this.chunkByteSize);
            if (chunk.size > this.chunkByteSize) {
              chunk = chunk.slice(this.chunkByteSize);
            }
            console.log('next outgoingChunk.size', outgoingChunk.size);
            yield outgoingChunk;
          }
        }
      } finally {
        console.log('in finally');
        // Last chunk, if any bits remain
        if (chunk) {
          const outgoingChunk = chunk;
          chunk = undefined;
          console.log('last outgoingChunk.size', outgoingChunk.size);
          yield outgoingChunk;
        }
        reader.releaseLock();
        return;
      }
    },
  };
};

// let remainingChunk = undefined;
// let fileChunkIterable = readableStreamIterable(file.stream());
// let combinedChunkIterable = combinedIterable(file.stream());
// conbminedChunkIterable.chunkSize = chunkSize;

// let fileChunkIterator = fileChunkIterable[Symbol.asyncIterator]();
// let uploadDone = false;
// let paused = false;
// while (!uploadDone && !paused) {
//   const { value, done } = await fileChunkIterator.next();
//   if (value) console.log('value.length', value.length);
//   uploadDone = done;
//   // console.log('not done!', 'done', done, upload);
// }

// this.attempts = options.attempts || 5;
// this.delayBeforeAttempt = options.delayBeforeAttempt || 1;

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
      resolve(lastChunkInterval);
    }, Math.floor(Math.random() * (5000 - 250 + 1) + 250));
  });
};

const picker = document.getElementById('picker');
picker.onchange = async () => {
  const endpoint = document.getElementById('location').value;
  const file = picker.files[0];
  console.log('file', file);

  let chunkSize = 30720;
  let maxChunkSize = 512000; // in kB
  let minChunkSize = 256; // in kB
  let iter = chunkedFileStreamIterableFactory(file.stream());
  iter.chunkSize = chunkSize;
  let sum = 0;

  console.log('chunkByteSize', iter.chunkByteSize);
  // NOTE: These async for loops will need to be slightly refactored and broken into a function to handle pause cases
  for await (const chunk of iter) {
    console.log('chunk.size', chunk.size);
    sum += chunk.size;
    let rttSecs = await uploadChunk(chunk);
    let unevenChunkSize;
    if (rttSecs < 10) {
      unevenChunkSize = Math.min(chunkSize * 2, maxChunkSize);
    } else if (lastChunkInterval > 30) {
      unevenChunkSize = Math.max(chunkSize / 2, minChunkSize);
    }
    // ensure it's a multiple of 256k
    chunkSize = Math.ceil(unevenChunkSize / 256) * 256;

    // chunkSize = Math.floor(Math.random() * (500 - 100 + 1) + 100);
    iter.chunkSize = chunkSize;
    console.log('chunkByteSize', iter.chunkByteSize);
  }

  console.log('total size', sum);
};
