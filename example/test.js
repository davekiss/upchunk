const readableStreamIterable = (readableStream) => {
  return {
    [Symbol.asyncIterator]: async function* () {
      const reader = readableStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            return;
          }
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
};

// NOTE: This could be combined with `readableStreamIterable` into a single iterable factory if that feels easier to work with
// NOTE: We may want to combine regardless for better memory management
// NOTE: This could be refactored into a class instead of a factory if that feels easier to work with
const choppedAndScrewedChunkIterable = (chunk) => {
  const defaultChunkSize = 30720;
  let _chunkSize;
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
      // NOTE: Since we don't know how big the next chunk needs to be, we should
      // just have a single blob that we "peel away bytes from" for each chunk
      // as we iterate.
      while (chunk) {
        // Last Chunk
        if (chunk.size <= this.chunkByteSize) {
          const outgoingChunk = chunk;
          chunk = undefined;
          yield outgoingChunk;
          return;
        }
        const outgoingChunk = chunk.slice(0, this.chunkByteSize);
        yield outgoingChunk;
        if (chunk.size > this.chunkByteSize) {
          chunk = chunk.slice(this.chunkByteSize);
        }
      }
    },
  };
};

const picker = document.getElementById('picker');
picker.onchange = async () => {
  const endpoint = document.getElementById('location').value;
  const file = picker.files[0];
  console.log('file', file);

  let chunkSize = 100;
  let remainingChunk = undefined;
  let fileChunkIterable = readableStreamIterable(file.stream());
  // NOTE: These async for loops will need to be slightly refactored and broken into a function to handle pause cases
  for await (const chunk of fileChunkIterable) {
    console.log('chunk.size', chunk.length);
    const incomingChunk =
      chunk instanceof Uint8Array
        ? new Blob([chunk], { type: 'application/octet-stream' })
        : chunk;
    const contattedChunk = remainingChunk
      ? new Blob([remainingChunk, incomingChunk])
      : incomingChunk;
    const choppyChunkIterable = choppedAndScrewedChunkIterable(contattedChunk, {
      remainingChunk,
    });
    remainingChunk = undefined;
    choppyChunkIterable.chunkSize = chunkSize;
    console.log('next chunkByteSize', choppyChunkIterable.chunkByteSize);
    for await (const choppedChunk of choppyChunkIterable) {
      // Here is where we make sure we save any remaining bytes for the next
      // outer iteration
      if (choppedChunk.size < choppyChunkIterable.chunkByteSize) {
        console.log('choppedChunk too small!', choppedChunk.size);
        remainingChunk = choppedChunk;
      } else {
        // Here is where we'd upload, retry, and recompute chunkSize based
        // on last round trip time (RTT)
        console.log('choppedChunk.size', choppedChunk.size);
        chunkSize = Math.floor(Math.random() * (500 - 100 + 1) + 100);
        choppyChunkIterable.chunkSize = chunkSize;
        console.log('next chunkByteSize', choppyChunkIterable.chunkByteSize);
      }
    }
  }

  // Here is where we'd upload the last chunk
  if (remainingChunk) {
    console.log('last remainingChunk.size', remainingChunk.size);
    remainingChunk = undefined;
  }
};
