FROM ubuntu:24.04 AS builder

RUN apt-get update && apt-get install -y build-essential cmake git curl \
    && rm -rf /var/lib/apt/lists/*

# Build whisper.cpp
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git /whisper \
    && cd /whisper && cmake -B build && cmake --build build --config Release -j

FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3-pip curl ca-certificates \
    && pip3 install --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=builder /whisper/build/src/libwhisper.so /usr/local/lib/
RUN ldconfig

# Download Swedish-optimized model (small = good speed/quality balance)
RUN mkdir -p /models && curl -sL \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" \
    -o /models/ggml-small.bin

WORKDIR /data
ENTRYPOINT ["whisper-cli"]
CMD ["--help"]
