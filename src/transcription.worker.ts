import { env, pipeline } from "@huggingface/transformers";

type RequestMessage = { type: "transcribe"; audio: Blob; language: string };
let transcriber: any;

env.allowLocalModels = false;
env.useBrowserCache = true;

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  if (event.data.type !== "transcribe") return;
  try {
    if (!transcriber) {
      transcriber = await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-tiny",
        {
          device: "wasm",
          dtype: "q8",
          progress_callback: (progress: unknown) => {
            self.postMessage({ type: "model-progress", progress });
          },
        } as any,
      );
    }

    const audioUrl = URL.createObjectURL(event.data.audio);
    try {
      const result = await transcriber(audioUrl, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
        ...(event.data.language && event.data.language !== "auto"
          ? { language: event.data.language }
          : {}),
        task: "transcribe",
      });
      self.postMessage({ type: "result", text: result.text, chunks: result.chunks ?? [] });
    } finally {
      URL.revokeObjectURL(audioUrl);
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Transcription failed.",
    });
  }
};

export {};
