# Transcribe-YT

Transcribe-YT is a Node.js application that downloads YouTube videos, extracts their audio, and transcribes them using OpenAI's Whisper API.

## Prerequisites

- Node.js (v20 or later recommended)
- Yarn v4
- FFmpeg installed on your system
- An OpenAI API key

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/transcribe-yt.git
   cd transcribe-yt
   ```

2. Install dependencies using Yarn v4:
   ```
   yarn install
   ```

3. Copy the example configuration file and edit it with your YouTube video URLs:
   ```
   cp config.example.yaml config.yaml
   ```
   Then edit `config.yaml` to include the YouTube video URLs you want to transcribe.

4. Create a `.env` file in the root directory and add your OpenAI API key:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```

## Usage

1. Ensure your `config.yaml` file contains the YouTube video URLs you want to transcribe.

2. Run the application:
   ```
   yarn start
   ```

The script will:
- Download the audio from each YouTube video
- Convert the audio to MP3 format
- Transcribe the audio using OpenAI's Whisper API
- Save the transcriptions in the `transcripts` directory
- Clean up the temporary audio files

## Configuration

- `config.yaml`: List the YouTube video URLs you want to transcribe.
- `.env`: Store your OpenAI API key.

## Project Structure

- `processVideos.ts`: Main script that handles video processing and transcription.
- `package.json`: Defines project dependencies and scripts.
- `config.yaml`: Contains the list of YouTube video URLs to process.
- `transcripts/`: Directory where transcriptions are saved.
- `audio/`: Temporary directory for audio files (cleaned up after processing).

## Dependencies

Key dependencies include:

- `@distube/ytdl-core`: For downloading YouTube videos
- `fluent-ffmpeg`: For audio processing
- `openai`: For interacting with the OpenAI API
- `js-yaml`: For parsing the YAML configuration file
- `tsx`: For running TypeScript files directly

For a full list of dependencies, refer to `package.json`.

## License

This project is licensed under the UNLICENSED license.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Disclaimer

This tool is for educational and personal use only. Ensure you have the right to download and transcribe the YouTube content you're processing.
