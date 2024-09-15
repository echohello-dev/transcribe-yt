import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';
import ytdl from '@distube/ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import OpenAI from 'openai';
import cliProgress, { SingleBar } from 'cli-progress';
import yaml from 'js-yaml';

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY is not set in the environment variables.');
  process.exit(1);
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// {{ edit_2: Read video URLs from config.yaml }}
const configPath = path.join(__dirname, 'config.yaml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as { videoUrls: string[] };
const VIDEO_URLS: string[] = config.videoUrls;

const TRANSCRIPTS_DIR = path.join(__dirname, 'transcripts');
const AUDIO_DIR = path.join(__dirname, 'audio');

// Ensure directories exist
fs.ensureDirSync(TRANSCRIPTS_DIR);
fs.ensureDirSync(AUDIO_DIR);

/**
 * Downloads YouTube audio and converts it to MP3 with a filename based on video title and author.
 * @param videoUrl - The YouTube video URL.
 * @returns Path to the downloaded MP3 file, video title, and author.
 */
async function downloadAudio(videoUrl: string): Promise<{ audioPath: string; videoTitle: string; videoAuthor: string }> {
  const info = await ytdl.getInfo(videoUrl);
  const videoTitle = info.videoDetails.title.replace(/[^a-z0-9 \-_]/gi, '');
  const videoAuthor = info.videoDetails.author.name.replace(/[^a-z0-9 \-_]/gi, '');
  const output = path.join(AUDIO_DIR, `${videoTitle} - ${videoAuthor}.mp3`);
  const audioStream = ytdl(videoUrl, { filter: 'audioonly' });

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(audioStream)
      .audioBitrate(128)
      .format('mp3')
      .on('error', (err: Error) => {
        console.error(`Error during conversion for ${videoTitle}: ${err.message}`);
        reject(err);
      })
      .on('end', () => {
        console.log(`Download and conversion to MP3 completed for ${videoTitle}.`);
        resolve({ audioPath: output, videoTitle, videoAuthor });
      })
      .save(output);
  });
}

/**
 * Transcribes audio using OpenAI Whisper API.
 * @param filePath - Path to the MP3 file.
 * @returns Transcribed text.
 */
async function transcribeAudio(filePath: string): Promise<string> {
  try {
    const fileStream = fs.createReadStream(filePath);
    const response = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
    });
    return response.text;
  } catch (error: any) {
    if (error.response) {
      console.error(`Error transcribing ${filePath}:`, error.response.data);
    } else {
      console.error(`Error transcribing ${filePath}:`, error.message);
    }
    return '';
  }
}

/**
 * Processes a single YouTube video: downloads audio and transcribes it.
 * @param videoUrl - The YouTube video URL.
 * @param progressBar - The progress bar instance.
 */
async function processVideo(videoUrl: string, progressBar: SingleBar) {
  try {
    const info = await ytdl.getInfo(videoUrl);
    const videoTitle = info.videoDetails.title.replace(/[^a-z0-9 \-_]/gi, '');
    const videoAuthor = info.videoDetails.author.name.replace(/[^a-z0-9 \-_]/gi, '');
    const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoTitle} - ${videoAuthor}.txt`);

    if (await fs.pathExists(transcriptPath)) {
      console.log(`Transcript already exists for "${videoTitle}". Skipping transcription.`);
      return;
    }

    progressBar.start(100, 0, { videoId: 'Initializing' });

    // Download audio
    progressBar.update(10, { videoId: `Downloading audio` });
    const { audioPath } = await downloadAudio(videoUrl);
    progressBar.update(50, { videoId: `Downloaded: ${videoTitle}` });

    // Transcribe audio
    progressBar.update(60, { videoId: `Transcribing: ${videoTitle}` });
    const transcript = await transcribeAudio(audioPath);
    progressBar.update(90, { videoId: `Transcribed: ${videoTitle}` });

    // Save transcript
    await fs.writeFile(transcriptPath, transcript.trim());
    progressBar.update(100, { videoId: `Completed: ${videoTitle}` });
    console.log(`Transcript saved to ${transcriptPath}`);

    // Clean up audio file
    await fs.remove(audioPath);
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
  const progressBar = new cliProgress.SingleBar({
    format: '{videoId} |{bar}| {percentage}% ',
    hideCursor: true,
  }, cliProgress.Presets.shades_classic);

  for (const videoUrl of VIDEO_URLS) {
    await processVideo(videoUrl, progressBar);
  }

  console.log('All videos have been processed.');
}

main();