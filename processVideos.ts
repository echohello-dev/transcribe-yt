import dotenv from "dotenv";
import fs from "fs-extra";
import path from "path";
import ytdl from "@distube/ytdl-core";
import ffmpeg from "fluent-ffmpeg";
import OpenAI from "openai";
import cliProgress from "cli-progress";
import yaml from "js-yaml";
import pLimit from "p-limit";
import * as art from "ascii-art"; // Updated import statement

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error(
    "Error: OPENAI_API_KEY is not set in the environment variables.",
  );
  process.exit(1);
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const configPath = path.join(__dirname, "config.yaml");
const config = yaml.load(fs.readFileSync(configPath, "utf8")) as {
  videoUrls: string[];
  proxies: string[];
};
const VIDEO_URLS: string[] = config.videoUrls;

const TRANSCRIPTS_DIR = path.join(__dirname, "transcripts");
const AUDIO_DIR = path.join(__dirname, "audio");
const CHUNKS_DIR = path.join(__dirname, "chunks");

// Ensure directories exist
fs.ensureDirSync(TRANSCRIPTS_DIR);
fs.ensureDirSync(AUDIO_DIR);
fs.ensureDirSync(CHUNKS_DIR);

/**
 * Downloads YouTube audio and converts it to MP3 with a filename based on video title and author.
 * @param videoUrl - The YouTube video URL.
 * @returns Path to the downloaded MP3 file, video title, and author.
 */
async function downloadAudio(
  videoUrl: string,
): Promise<{ audioPath: string; videoTitle: string; videoAuthor: string }> {
  const info = await ytdl.getInfo(videoUrl);
  const videoTitle = info.videoDetails.title.replace(/[^a-z0-9 \-_]/gi, "");
  const videoAuthor = info.videoDetails.author.name.replace(
    /[^a-z0-9 \-_]/gi,
    "",
  );
  const output = path.join(AUDIO_DIR, `${videoTitle} - ${videoAuthor}.mp3`);

  if (await fs.pathExists(output)) {
    console.log(
      `MP3 file already exists for "${videoTitle}". Skipping download.`,
    );
    return { audioPath: output, videoTitle, videoAuthor };
  }

  const audioStream = ytdl(videoUrl, { filter: "audioonly" });

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(audioStream)
      .audioBitrate(128)
      .format("mp3")
      .on("error", (err: Error) => {
        console.error(
          `Error during conversion for ${videoTitle}: ${err.message}`,
        );
        reject(err);
      })
      .on("end", () => {
        console.log(
          `Download and conversion to MP3 completed for ${videoTitle}.`,
        );
        resolve({ audioPath: output, videoTitle, videoAuthor });
      })
      .save(output);
  });
}

/**
 * Splits the audio file into smaller chunks under the specified size limit.
 * @param filePath - Path to the original MP3 file.
 * @param videoTitle - Title of the video (used for chunk directory).
 * @param videoId - ID of the video (used for chunk directory).
 * @param chunkSizeMB - Maximum size for each chunk in MB.
 * @returns Array of chunk file paths.
 */
async function splitAudio(
  filePath: string,
  videoTitle: string,
  videoId: string,
  chunkSizeMB: number = 25,
): Promise<string[]> {
  const stats = await fs.stat(filePath);
  const fileSize = stats.size;
  const chunkSize = chunkSizeMB * 1024 * 1024; // Convert MB to bytes
  const numberOfChunks = Math.ceil(fileSize / chunkSize);
  const chunks: string[] = [];

  if (numberOfChunks <= 1) {
    return [filePath];
  }

  // Create a unique directory for chunks of this video
  const videoChunksDir = path.join(CHUNKS_DIR, `${videoTitle}-${videoId}`);
  await fs.ensureDir(videoChunksDir);

  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .outputOptions([
        `-f segment`,
        `-segment_time ${chunkSizeMB * 60}`, // Use fixed segment time in seconds
        `-reset_timestamps 1`,
      ])
      .output(path.join(videoChunksDir, "chunk-%03d.mp3"))
      .on("end", async () => {
        try {
          const files = await fs.readdir(videoChunksDir);
          const chunkFiles = files
            .filter(
              (file) => file.startsWith("chunk-") && file.endsWith(".mp3"),
            )
            .map((file) => path.join(videoChunksDir, file))
            .sort((a, b) => {
              const aNum = parseInt(a.match(/\d+/)?.[0] || "0");
              const bNum = parseInt(b.match(/\d+/)?.[0] || "0");
              return aNum - bNum;
            });

          if (chunkFiles.length === 0) {
            throw new Error("No chunks were created");
          }

          console.log(`Created ${chunkFiles.length} chunks for ${videoTitle}`);
          resolve(chunkFiles);
        } catch (error) {
          reject(error);
        }
      })
      .on("error", (err: Error) => {
        reject(err);
      })
      .run();
  });
}

/**
 * Transcribes audio using OpenAI Whisper API with retry mechanism.
 * @param filePath - Path to the MP3 file.
 * @param maxRetries - Maximum number of retry attempts.
 * @param retryDelay - Delay between retries in milliseconds.
 * @returns Transcribed text.
 */
async function transcribeAudio(
  filePath: string,
  maxRetries = 3,
  retryDelay = 5000,
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const fileStream = fs.createReadStream(filePath);
      const response = await openai.audio.transcriptions.create({
        file: fileStream,
        model: "whisper-1",
      });
      return response.text;
    } catch (error: any) {
      if (attempt === maxRetries) {
        console.error(
          `Error transcribing ${filePath} after ${maxRetries} attempts:`,
          error.message,
        );
        return "";
      }
      console.warn(
        `Attempt ${attempt} failed for ${filePath}. Retrying in ${retryDelay / 1000} seconds...`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
  return ""; // This line should never be reached, but TypeScript requires it
}

/**
 * Processes a single YouTube video: downloads audio, splits if necessary, and transcribes it.
 * @param videoUrl - The YouTube video URL.
 */
async function processVideo(videoUrl: string) {
  const progressBar = new cliProgress.SingleBar(
    {
      format: "{videoId} |{bar}| {percentage}% ",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  );

  try {
    const info = await ytdl.getInfo(videoUrl);
    const videoTitle = info.videoDetails.title.replace(/[^a-z0-9 \-_]/gi, "");
    const videoAuthor = info.videoDetails.author.name.replace(
      /[^a-z0-9 \-_]/gi,
      "",
    );
    const videoId = info.videoDetails.videoId;
    const transcriptPath = path.join(
      TRANSCRIPTS_DIR,
      `${videoTitle} - ${videoAuthor}.txt`,
    );

    if (await fs.pathExists(transcriptPath)) {
      console.log(
        `Transcript already exists for "${videoTitle}". Skipping transcription.`,
      );
      return;
    }

    progressBar.start(100, 0, { videoId: "Initializing" });

    // Download audio
    progressBar.update(10, { videoId: `Downloading audio` });
    const { audioPath } = await downloadAudio(videoUrl);
    progressBar.update(30, { videoId: `Downloaded: ${videoTitle}` });

    // Split audio if necessary
    progressBar.update(40, { videoId: `Splitting audio` });
    const chunks = await splitAudio(audioPath, videoTitle, videoId);
    progressBar.update(50, {
      videoId: `Audio split into ${chunks.length} chunks`,
    });

    // Transcribe each chunk
    let fullTranscript = "";
    for (let i = 0; i < chunks.length; i++) {
      progressBar.update(50 + (i / chunks.length) * 40, {
        videoId: `Transcribing chunk ${i + 1}`,
      });
      const transcript = await transcribeAudio(chunks[i]);
      if (transcript) {
        fullTranscript += transcript + " ";
      } else {
        console.warn(
          `Failed to transcribe chunk ${i + 1} for ${videoTitle} after multiple attempts.`,
        );
      }
    }

    // Save transcript
    progressBar.update(95, { videoId: `Saving transcript` });
    await fs.writeFile(transcriptPath, fullTranscript.trim());
    progressBar.update(100, { videoId: `Completed: ${videoTitle}` });
    console.log(`Transcript saved to ${transcriptPath}`);

    // Cleanup chunks
    await fs.remove(path.join(CHUNKS_DIR, `${videoTitle}-${videoId}`));

    progressBar.stop();
  } catch (err) {
    console.error(`An error occurred while processing ${videoUrl}:`, err);
    progressBar.stop();
  }
}

/**
 * Main function to process all videos.
 */
async function main() {
  const CONCURRENCY_LIMIT = 3;
  const limit = pLimit(CONCURRENCY_LIMIT);

  await Promise.all(
    VIDEO_URLS.map((videoUrl) => limit(() => processVideo(videoUrl))),
  );

  const rendered = await art.font("Success!", "Doom").toPromise();
  console.log(rendered);
  console.log("All videos have been processed.");
}

main();
